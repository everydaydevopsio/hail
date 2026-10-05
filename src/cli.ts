#!/usr/bin/env node
import { parseArgs, promisify } from "node:util";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolveMx } from "node:dns/promises";
import {
  SESClient,
  DescribeActiveReceiptRuleSetCommand,
  GetIdentityVerificationAttributesCommand,
  type DescribeActiveReceiptRuleSetCommandOutput,
} from "@aws-sdk/client-ses";
import { loadConfig, parseConfig, type HailConfig } from "./config.js";
import { S3MailStore, awsCredentials } from "./store.js";
import { scaffold, validateInit, type InitOptions } from "./setup.js";

const execute = promisify(execFile);
const help = `Hail: Send. Receive. Verify.\n\nCommands:\n  hail init --dns cloudflare|route53|manual --domain email-test.example.com\n    --zone-name example.com [--zone-id ID] --region us-east-1\n    (--existing-rule-set NAME | --activate-new-rule-set) [--out infra/hail]\n  hail configure --terraform-dir infra/hail [--out hail.config.json]\n  hail doctor [--config hail.config.json]\n\ninit only generates files after read-only checks; it never runs terraform apply.\nconfigure reads Terraform outputs; doctor never sends email.\n`;

async function activeRules(
  region: string,
  config?: HailConfig,
): Promise<DescribeActiveReceiptRuleSetCommandOutput> {
  const client = new SESClient({
    region,
    credentials: config ? awsCredentials(config) : undefined,
  });
  try {
    return await client.send(new DescribeActiveReceiptRuleSetCommand({}), {
      abortSignal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      ["RuleSetDoesNotExist", "RuleSetDoesNotExistException"].includes(
        error.name,
      )
    )
      return { $metadata: {} };
    throw error;
  }
}
async function checkNewDomain(domain: string): Promise<void> {
  try {
    if ((await resolveMx(domain)).length)
      throw new Error(
        "This domain already has MX records. Use a fresh test subdomain or explicitly migrate/import the existing records outside init.",
      );
  } catch (error) {
    if (
      ["ENODATA", "ENOTFOUND"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      return;
    throw error;
  }
}
async function doctor(config: HailConfig) {
  const results: { check: string; ok: boolean; detail: string }[] = [];
  const check = async (name: string, operation: () => Promise<void>) => {
    try {
      await operation();
      results.push({ check: name, ok: true, detail: "Passed" });
    } catch (error) {
      results.push({
        check: name,
        ok: false,
        detail:
          error instanceof Error && error.name === "Error"
            ? error.message
            : `Check failed (${error instanceof Error ? error.name : "unknown error"}).`,
      });
    }
  };
  await check("dns-mx", async () => {
    const expected = `inbound-smtp.${config.region}.amazonaws.com`;
    const records = await resolveMx(config.domain);
    if (
      !records.length ||
      records.some(
        (record) =>
          record.exchange.toLowerCase().replace(/\.$/, "") !== expected,
      )
    )
      throw new Error(
        "MX does not exclusively target this SES receiving region.",
      );
  });
  await check("ses-identity", async () => {
    const ses = new SESClient({
      region: config.region,
      credentials: awsCredentials(config),
    });
    const result = await ses.send(
      new GetIdentityVerificationAttributesCommand({
        Identities: [config.domain],
      }),
      { abortSignal: AbortSignal.timeout(20_000) },
    );
    if (
      result.VerificationAttributes?.[config.domain]?.VerificationStatus !==
      "Success"
    )
      throw new Error("SES receiving identity is not verified yet.");
  });
  await check("active-receipt-rule", async () => {
    const active = await activeRules(config.region, config);
    if (config.ruleSetName && active.Metadata?.Name !== config.ruleSetName)
      throw new Error("Expected SES receipt rule set is not active.");
    const found = active.Rules?.some(
      (rule) =>
        rule.Enabled &&
        (!config.ruleName || rule.Name === config.ruleName) &&
        rule.Recipients?.includes(config.domain) &&
        rule.Actions?.some(
          (action) => action.S3Action?.BucketName === config.bucketName,
        ),
    );
    if (!found)
      throw new Error(
        "No enabled receipt rule routes this domain into the configured bucket.",
      );
  });
  await check("s3-reader", async () => {
    const store = new S3MailStore(config);
    await store.list(
      `hail-doctor@${config.domain}`,
      AbortSignal.timeout(20_000),
    );
  });
  console.log(
    JSON.stringify(
      {
        results,
        deliveryTested: false,
        note: "Read-only checks only. Queue health, object reads, and actual email delivery require separate validation; run the opt-in live suite.",
      },
      null,
      2,
    ),
  );
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "help") {
    console.log(help);
    return;
  }
  const { values } = parseArgs({
    args,
    options: {
      dns: { type: "string" },
      domain: { type: "string" },
      "zone-name": { type: "string" },
      "zone-id": { type: "string" },
      region: { type: "string" },
      name: { type: "string" },
      out: { type: "string" },
      "existing-rule-set": { type: "string" },
      "activate-new-rule-set": { type: "boolean" },
      "terraform-dir": { type: "string" },
      config: { type: "string" },
    },
  });
  if (command === "init") {
    const options = validateInit({
      dns: (values.dns ?? "manual") as InitOptions["dns"],
      domain: values.domain ?? "",
      zoneName: values["zone-name"] ?? "",
      zoneId: values["zone-id"],
      region: values.region ?? "us-east-1",
      name: values.name ?? "hail",
      out: values.out ?? "infra/hail",
      existingRuleSet: values["existing-rule-set"],
      activateNewRuleSet: values["activate-new-rule-set"],
    });
    await checkNewDomain(options.domain);
    const active = await activeRules(options.region);
    if (options.activateNewRuleSet && active.Metadata?.Name)
      throw new Error(
        "An SES rule set is already active. Use --existing-rule-set instead; Hail will not replace it.",
      );
    if (
      options.existingRuleSet &&
      active.Metadata?.Name !== options.existingRuleSet
    )
      throw new Error(
        "The requested existing SES rule set is not active in this region.",
      );
    const destination = await scaffold(options);
    console.log(
      `Created ${destination}. Review the files, configure reader access, then run terraform init, plan, and apply there. Copy example.spec.ts into your tests and adapt its selectors. No cloud resources were changed.`,
    );
  } else if (command === "configure") {
    if (!values["terraform-dir"])
      throw new Error("configure requires --terraform-dir.");
    const { stdout } = await execute(
      "terraform",
      [`-chdir=${values["terraform-dir"]}`, "output", "-json", "hail_config"],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    const config = parseConfig(JSON.parse(stdout));
    const destination = values.out ?? "hail.config.json";
    await writeFile(destination, JSON.stringify(config, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    console.log(`Wrote ${destination}. Existing files are never overwritten.`);
  } else if (command === "doctor") {
    await doctor(await loadConfig(values.config));
  } else throw new Error("Unknown command. Run hail --help.");
}
main().catch((error) => {
  const known = error instanceof Error && error.name === "Error";
  console.error(
    known
      ? error.message
      : `Hail failed (${error instanceof Error ? error.name : "unknown error"}). Check configuration and credentials.`,
  );
  process.exitCode = 1;
});
