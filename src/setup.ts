import { mkdir, cp, readFile, writeFile, lstat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeDomain } from "./config.js";

export interface InitOptions {
  dns: "cloudflare" | "route53" | "manual";
  domain: string;
  zoneName: string;
  zoneId?: string;
  region: string;
  name: string;
  out: string;
  file?: string;
  localModules?: boolean;
  existingRuleSet?: string;
  activateNewRuleSet?: boolean;
}
export function validateInit(
  options: InitOptions,
): InitOptions & { file: string } {
  const file = options.file ?? "main.tf";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.tf$/.test(file))
    throw new Error(
      "--file must be a Terraform file name ending in .tf, without a path.",
    );
  if (!["cloudflare", "route53", "manual"].includes(options.dns))
    throw new Error("--dns must be cloudflare, route53, or manual.");
  let domain: string;
  let zoneName: string;
  try {
    domain = normalizeDomain(options.domain);
  } catch (error) {
    throw new Error("--domain must be a valid ASCII DNS domain.", {
      cause: error,
    });
  }
  try {
    zoneName = normalizeDomain(options.zoneName);
  } catch (error) {
    throw new Error("--zone-name must be a valid ASCII DNS domain.", {
      cause: error,
    });
  }
  if (domain === zoneName || !domain.endsWith(`.${zoneName}`))
    throw new Error(
      "Use a dedicated subdomain inside the selected DNS zone, not its apex.",
    );
  if (options.dns !== "manual" && !options.zoneId)
    throw new Error("Managed DNS requires --zone-id.");
  if (!/^[a-z][a-z0-9-]{2,31}$/.test(options.name))
    throw new Error("--name must be 3-32 lowercase characters.");
  if (
    ![
      "us-east-1",
      "us-east-2",
      "us-west-2",
      "ca-central-1",
      "eu-west-1",
    ].includes(options.region)
  )
    throw new Error(
      "--region must be a receiving region supported by this release.",
    );
  if (Boolean(options.existingRuleSet) === Boolean(options.activateNewRuleSet))
    throw new Error(
      "Choose exactly one: --existing-rule-set NAME or --activate-new-rule-set.",
    );
  return { ...options, domain, zoneName, file };
}

export async function scaffold(input: InitOptions): Promise<string> {
  const options = validateInit(input);
  const destination = resolve(options.out);
  const templates = fileURLToPath(new URL("../terraform/", import.meta.url));
  const parent = resolve(destination, "..");
  await mkdir(parent, { recursive: true });
  await mkdir(destination, { recursive: true });
  const targets = [options.file, "terraform.tfvars.json", "example.spec.ts"];
  if (options.localModules) targets.push("modules");
  for (const target of targets) {
    try {
      await lstat(join(destination, target));
      throw Object.assign(new Error(`File already exists: ${target}`), {
        code: "EEXIST",
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const template = await readFile(
    join(templates, "examples", options.dns, "main.tf"),
    "utf8",
  );
  const packageVersion = options.localModules
    ? undefined
    : (
        JSON.parse(
          await readFile(
            fileURLToPath(new URL("../package.json", import.meta.url)),
            "utf8",
          ),
        ) as { version: string }
      ).version;
  const source = options.localModules
    ? "./modules/receiver"
    : `git::https://github.com/everydaydevopsio/hail.git//terraform/modules/receiver?ref=v${packageVersion}`;
  await writeFile(
    join(destination, options.file),
    template.replace("../../modules/receiver", source),
    { flag: "wx" },
  );
  if (options.localModules)
    await cp(
      join(templates, "modules", "receiver"),
      join(destination, "modules", "receiver"),
      {
        recursive: true,
        force: false,
        errorOnExist: true,
        filter: (path) =>
          !path.includes(".terraform") &&
          !path.includes("__pycache__") &&
          !path.endsWith(".zip"),
      },
    );
  const variables = {
    name: options.name,
    domain: options.domain,
    zone_name: options.zoneName,
    region: options.region,
    ...(options.dns === "manual" ? {} : { zone_id: options.zoneId }),
    existing_rule_set_name: options.existingRuleSet ?? null,
    manage_rule_set_activation: options.activateNewRuleSet ?? false,
    retention_days: 3,
    reader_principal_arns: [],
    external_indexer_role_arn: null,
    external_reader_role_arn: null,
    permissions_boundary_arn: null,
    tags: {},
  };
  await writeFile(
    join(destination, "terraform.tfvars.json"),
    JSON.stringify(variables, null, 2) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  try {
    await writeFile(
      join(destination, ".gitignore"),
      ".terraform/\n*.tfstate*\n*.tfvars*\n*.tfplan\n**/lambda.zip\n",
      { flag: "wx" },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await writeFile(
    join(destination, "example.spec.ts"),
    `import { test, expect, visitAuthLink } from '@everydaydevopsio/hail/playwright';\n\ntest('magic-link login', async ({ page, inbox }) => {\n  test.setTimeout(90_000);\n  await page.goto('/login');\n  const after = await inbox.checkpoint();\n  await page.getByLabel('Email').fill(inbox.address);\n  await page.getByRole('button', { name: /send magic link/i }).click();\n  const email = await inbox.waitForEmail({ after, subject: /sign in/i });\n  const origin = new URL(page.url()).origin;\n  await visitAuthLink(page, email.getLink({ text: /sign in/i, allowedOrigins: [origin] }));\n  await expect(page.getByTestId('current-user-email')).toHaveText(inbox.address);\n});\n`,
    { flag: "wx" },
  );
  return destination;
}
