# Quickstart: test an email workflow with Hail

Deploy a receiver in your AWS account, then let a Playwright test receive and use your application's magic link. Your application keeps its existing email sender. Each test attempt gets a unique address; you deploy infrastructure once, not per test.

This guide uses Cloudflare first, with Route53 and manual DNS alternatives. Read [security and operations](SECURITY.md) before deployment.

## 1. Prepare

You need:

- Node.js 22+, npm, Git, and Terraform 1.7+ (below 2.0).
- An AWS account and an authorized provisioning identity using the normal AWS credential chain.
- A fresh test subdomain, such as `email-test.example.com`, inside an existing authoritative DNS zone. It must have no existing MX records. Never use the company mail domain.
- Access to the selected DNS zone. For Cloudflare, supply a zone-scoped `CLOUDFLARE_API_TOKEN` through your shell or secret manager with DNS editing and zone-read permission.
- An existing developer/CI IAM principal that will assume the receiver's reader role.
- An application with a working email sender and a test environment that permits your test users.

Use `us-east-1` for the example. Confirm the AWS account and region before proceeding. Only one SES receipt rule set can be active per region: identify the active set and inspect its rule ordering, including stop and bounce actions.

Provisioning and DNS changes below require your infrastructure owner's authorization. For precreated, restricted IAM roles, follow [IAM bootstrap](IAM-BOOTSTRAP.md) and the external-role guidance in [security](SECURITY.md#permissions-and-diagnostics).

## 2. Install Hail from source

This section documents installation from a source checkout. Published versions are available as [`@everydaydevopsio/hail` on npm](https://www.npmjs.com/package/@everydaydevopsio/hail).

```bash
git clone https://github.com/everydaydevopsio/hail.git
cd hail
git rev-parse HEAD
npm ci
HAIL_TARBALL=$(npm pack --silent)
```

Record the full commit SHA printed above for the Terraform source in step 3. For reproducible setup, use a reviewed commit available on GitHub for both the package and module. `npm pack` builds the package and saves its tarball name in `HAIL_TARBALL` for the same shell.

In your application's repository:

```bash
npm install --save-dev "/absolute/path/to/hail/$HAIL_TARBALL" @playwright/test
npx playwright install --with-deps chromium
npx hail --help
```

Use the actual source checkout path in the command above. Hail's entry points are ESM; the consumer project must use `"type": "module"` in `package.json`.

## 3. Generate Terraform and use the GitHub module

Run from your application's repository, replacing the domain, zone ID, and active receipt rule set:

```bash
npx hail init \
  --dns cloudflare \
  --domain email-test.example.com \
  --zone-name example.com \
  --zone-id YOUR_EXISTING_CLOUDFLARE_ZONE_ID \
  --region us-east-1 \
  --name myapp-hail \
  --existing-rule-set shared-inbound \
  --out infra/hail \
  --file hail-receiver.tf \
  --local-modules
```

Choose the appropriate alternative before running:

- **Route53:** replace `--dns cloudflare` with `--dns route53` and supply an existing public hosted zone ID.
- **Manual DNS:** use `--dns manual` and omit `--zone-id`.
- **No active SES receipt rule set:** replace `--existing-rule-set shared-inbound` with `--activate-new-rule-set` only when authorized to activate a new set. The CLI refuses to replace an active set.

The initializer performs read-only preflight checks and creates Terraform files. This source-checkout example uses `--local-modules` because the package version might not have a matching published Git tag. For a released package, omit that option: the generated receiver source is pinned to the matching `v<package version>` Git tag. `--out` can name a new or existing directory, and `--file` names the generated `.tf` file within it. Existing generated files and existing MX records are refused; infrastructure is not applied.

For a reviewed Git commit instead of the copied local module, in `infra/hail/hail-receiver.tf` replace the generated `source = "./modules/receiver"` inside `module "receiver"` with:

```hcl
source = "git::https://github.com/everydaydevopsio/hail.git//terraform/modules/receiver?ref=REVIEWED_COMMIT_SHA"
```

Replace `REVIEWED_COMMIT_SHA` with the full SHA recorded in step 2. Keep the other generated module arguments and resources. The double slash selects the module directory within the GitHub repository. Terraform downloads the module and its bundled Lambda worker from that commit; the generated local module copy is then unused. A released package's default tag pins the corresponding module without this edit.

In `infra/hail/terraform.tfvars.json`, replace the empty reader list with your actual trusted principal, for example:

```json
"reader_principal_arns": [
  "arn:aws:iam::123456789012:role/myapp-test-runner"
]
```

This is an excerpt, not a replacement for the whole JSON file. The module creates a reader role trusted by that principal and exports its ARN in `hail_config`. The caller also needs authorization to assume that role (`sts:AssumeRole`), subject to your account policies. Use a restricted test identity when running browser tests.

Review resource names, the three-day default mail retention, IAM access, and an access-controlled Terraform state backend. Keep credentials out of Terraform variables and Git. Commit the provider lockfile; exclude state, plans, and credential/config files.

## 4. Review and deploy

From your application repository:

```bash
terraform -chdir=infra/hail init
terraform -chdir=infra/hail validate
terraform -chdir=infra/hail plan -out=hail.tfplan
```

Review the saved plan and recheck DNS and active SES rules. Confirm that only the intended test subdomain and receiver resources change. When authorized, apply that reviewed plan:

```bash
terraform -chdir=infra/hail apply hail.tfplan
```

Cloudflare and Route53 configurations publish MX/TXT records and wait for SES verification. DNS propagation may take time.

For **manual DNS**, apply does not wait for DNS. Run:

```bash
terraform -chdir=infra/hail output dns_records
```

Add exactly those MX and TXT records at the authoritative DNS provider and wait for propagation and SES verification. Do not replace existing mail routing or change registrar/nameserver settings.

## 5. Connect the test runner

From the application repository:

```bash
npx hail configure --terraform-dir infra/hail
npx hail doctor
```

Run `doctor` with the intended reader credentials. `configure` writes an owner-only `hail.config.json` containing receiver settings and the reader role ARN. It refuses to overwrite an existing file. Add `hail.config.json` to your application's `.gitignore`; the CLI does not update that root file. Run tests from this directory, or set `HAIL_CONFIG` to the configuration's absolute path.

`doctor` checks DNS, SES identity, the active matching receipt rule, and S3 listing access. It does not prove delivery, raw-message read access, full rule-order safety, or ingestion health.

## 6. Run your first Playwright test

Add or merge these settings into `playwright.config.ts`, using your application's test URL:

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  use: {
    baseURL: "http://localhost:3000",
    browserName: "chromium",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
```

Create `tests/email-login.spec.ts`. Adapt the selectors, subject, and final assertion to your application:

```typescript
import { test, expect, visitAuthLink } from "@everydaydevopsio/hail/playwright";

test("sign in using a delivered magic link", async ({ page, inbox }) => {
  test.setTimeout(90_000);
  await page.goto("/login");
  const after = await inbox.checkpoint();
  await page.getByLabel("Email").fill(inbox.address);
  await page.getByRole("button", { name: /send magic link/i }).click();

  const email = await inbox.waitForEmail({
    after,
    subject: /sign in/i,
    timeoutMs: 60_000,
  });
  const origin = new URL(page.url()).origin;
  const link = email.getLink({
    text: /sign in/i,
    allowedOrigins: [origin],
  });
  await visitAuthLink(page, link);
  await expect(page.getByTestId("current-user-email")).toHaveText(inbox.address);
});
```

Start your application and, when authorized to trigger real test email, run:

```bash
npx playwright test tests/email-login.spec.ts
```

The fixture creates a fresh inbox for each attempt, including retries. The checkpoint excludes older receipts, and the wait is bounded. Link extraction does not fetch the URL; `visitAuthLink` opens it in the requesting browser and redacts navigation errors. Configure your application to generate links for the test environment rather than rewriting signed URLs. Invitation tests need separate administrator and invitee browser contexts.

Keep mail bodies, codes, cookies, and authentication URLs out of logs and reports. Leave traces, screenshots, and video disabled for these flows; review third-party reporters and log access too. If your application requires pre-existing users, seed the generated address through authorized test setup.

## If the test does not receive mail

- Confirm your application actually sent to `inbox.address` and that the subject filter matches.
- Recheck DNS propagation, SES verification, active rule set, and preceding rules.
- Have an operations identity inspect the ingestion queue, Lambda errors, and DLQ. Obtain its URL with `terraform -chdir=infra/hail output -raw dlq_url`.
- Confirm the reader can assume its role and read raw objects as well as list indexes.
- If the application's sender uses SES sandbox mode, check its recipient-verification restrictions separately.

A successful application test provides evidence for that workflow. Before claiming a verified deployment or release, follow [live verification](LIVE-VERIFICATION.md) and record separate live evidence. Local mocks, Terraform validation, and `doctor` alone are insufficient. Keep ordinary PR CI credential-free and read-only; invoke live tests explicitly with protected credentials.

Messages expire asynchronously through S3 lifecycle. Cleanup does not occur after each test, and Terraform will not destroy a nonempty receiver bucket by default. Follow the [cleanup guidance](LIVE-VERIFICATION.md#cleanup) when retiring the receiver.
