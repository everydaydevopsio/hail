import { mkdir, cp, readFile, writeFile } from "node:fs/promises";
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
  existingRuleSet?: string;
  activateNewRuleSet?: boolean;
}
export function validateInit(options: InitOptions): InitOptions {
  if (!["cloudflare", "route53", "manual"].includes(options.dns))
    throw new Error("Choose cloudflare, route53, or manual DNS.");
  const domain = normalizeDomain(options.domain);
  const zoneName = normalizeDomain(options.zoneName);
  if (domain === zoneName || !domain.endsWith(`.${zoneName}`))
    throw new Error(
      "Use a dedicated subdomain inside the selected DNS zone, not its apex.",
    );
  if (options.dns !== "manual" && !options.zoneId)
    throw new Error("Managed DNS requires --zone-id.");
  if (!/^[a-z][a-z0-9-]{2,31}$/.test(options.name))
    throw new Error("Resource name must be 3-32 lowercase characters.");
  if (
    ![
      "us-east-1",
      "us-east-2",
      "us-west-2",
      "ca-central-1",
      "eu-west-1",
    ].includes(options.region)
  )
    throw new Error("Choose a receiving region supported by this release.");
  if (Boolean(options.existingRuleSet) === Boolean(options.activateNewRuleSet))
    throw new Error(
      "Choose exactly one: --existing-rule-set NAME or --activate-new-rule-set.",
    );
  return { ...options, domain, zoneName };
}

export async function scaffold(input: InitOptions): Promise<string> {
  const options = validateInit(input);
  const destination = resolve(options.out);
  const templates = fileURLToPath(new URL("../terraform/", import.meta.url));
  const parent = resolve(destination, "..");
  await mkdir(parent, { recursive: true });
  // Exclusive directory creation: never replace an existing infrastructure tree.
  await mkdir(destination);
  const template = await readFile(
    join(templates, "examples", options.dns, "main.tf"),
    "utf8",
  );
  await writeFile(
    join(destination, "main.tf"),
    template.replace("../../modules/receiver", "./modules/receiver"),
    { flag: "wx" },
  );
  await cp(
    join(templates, "modules", "receiver"),
    join(destination, "modules", "receiver"),
    {
      recursive: true,
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
  await writeFile(
    join(destination, ".gitignore"),
    ".terraform/\n*.tfstate*\n*.tfvars*\n*.tfplan\n**/lambda.zip\n",
    { flag: "wx" },
  );
  await writeFile(
    join(destination, "example.spec.ts"),
    `import { test, expect, visitAuthLink } from '@everydaydevopsio/hail/playwright';\n\ntest('magic-link login', async ({ page, inbox }) => {\n  test.setTimeout(90_000);\n  await page.goto('/login');\n  const after = await inbox.checkpoint();\n  await page.getByLabel('Email').fill(inbox.address);\n  await page.getByRole('button', { name: /send magic link/i }).click();\n  const email = await inbox.waitForEmail({ after, subject: /sign in/i });\n  const origin = new URL(page.url()).origin;\n  await visitAuthLink(page, email.getLink({ text: /sign in/i, allowedOrigins: [origin] }));\n  await expect(page.getByTestId('current-user-email')).toHaveText(inbox.address);\n});\n`,
    { flag: "wx" },
  );
  return destination;
}
