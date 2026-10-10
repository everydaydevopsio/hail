# Hail

[![CI](https://github.com/everydaydevopsio/hail/actions/workflows/ci.yml/badge.svg)](https://github.com/everydaydevopsio/hail/actions/workflows/ci.yml) [![Release](https://github.com/everydaydevopsio/hail/actions/workflows/release.yml/badge.svg)](https://github.com/everydaydevopsio/hail/actions/workflows/release.yml) [![GitHub Release](https://img.shields.io/github/v/release/everydaydevopsio/hail)](https://github.com/everydaydevopsio/hail/releases) [![npm](https://img.shields.io/npm/v/%40everydaydevopsio%2Fhail.svg)](https://www.npmjs.com/package/@everydaydevopsio/hail) [![License](https://img.shields.io/github/license/everydaydevopsio/hail)](LICENSE)

**Send. Receive. Verify.**

Playwright-native tests for magic-link logins, invitations, one-time codes, and application email delivery. Hail receives real email in your own AWS account, gives each test a unique address, and helps your browser test complete the workflow.

**Status: available on [npm](https://www.npmjs.com/package/@everydaydevopsio/hail); live AWS delivery must be verified separately.** The automated suite separates local browser proof from the opt-in live delivery gate.

Maintainers can use the [manual npm release workflow](docs/RELEASING.md) after its registry trust and GitHub environment are configured. Adding the workflow alone does not publish a package.

Start with the [AWS quickstart](docs/QUICKSTART.md) to deploy with Cloudflare and a GitHub-sourced Terraform module, then run your first email workflow test.

## What is included

- TypeScript email client with unique inboxes, checkpoints, sender/subject filters, bounded waits, message consumption, pagination, and legacy SES-client storage support.
- Playwright `hail` and `inbox` fixtures. Link extraction parses HTML, requires allowed origins, and never fetches the link.
- `hail init`, `hail configure`, read-only `hail doctor`, and opt-in `hail smoke` commands.
- Terraform receiver and Cloudflare, Route53, and manual-DNS templates. No long-lived server, database, or Kubernetes cluster.
- One retryable SES → S3/SNS → SQS → Lambda ingestion path. The worker retains raw MIME and publishes idempotent recipient metadata. Failed records reach the ingestion DLQ.
- Unit, Python worker, Terraform mock, package, and Chromium/Firefox/WebKit workflow tests.

The application keeps its existing email sender. No mailbox or Terraform apply is needed per test. Unique addresses prevent accidental collisions; they are not an IAM isolation boundary.

## Validate this checkout without AWS

Requirements: Node.js 22+, Python 3.12+, and Terraform 1.7+ for infrastructure checks.

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run test:python
npx playwright install --with-deps chromium firefox webkit
npm run test:e2e

terraform -chdir=terraform/modules/receiver init -backend=false
terraform -chdir=terraform/modules/receiver validate
terraform -chdir=terraform/modules/receiver test
```

The browser tests use a loopback-only demo application and an in-memory MIME store. They test authenticated identity, one-time token reuse, server-side expiry, invitation roles, revocation, and isolated inboxes. They **do not prove internet email delivery** or test your application's selectors and authorization model.

## Install from this checkout

The package is named `@everydaydevopsio/hail`. A checkout can be packed locally whether or not that version has been published.
Its JavaScript entry points are ESM; use an ESM consumer project (`"type": "module"`) for Playwright TypeScript specs.

```bash
npm ci
HAIL_TARBALL=$(npm pack --silent)
# In your application repository, in the same shell:
npm install --save-dev "/path/to/hail/$HAIL_TARBALL" @playwright/test
npx hail --help
```

Terraform templates and the worker are included in the tarball. Original source snapshots, test output, state files, and email contents are not.

## Set up a dedicated email test domain

Start with a fresh subdomain such as `email-test.example.com`. Never point the company email domain at Hail. Use an existing authoritative DNS zone; changing registrar or nameservers is not required.

For Cloudflare, configure a zone-scoped `CLOUDFLARE_API_TOKEN` in your shell. The token needs DNS editing and permission to read the selected zone. AWS credentials use the normal SDK/provider chain.

```bash
npx hail init \
  --dns cloudflare \
  --domain email-test.example.com \
  --zone-name example.com \
  --zone-id YOUR_EXISTING_CLOUDFLARE_ZONE_ID \
  --region us-east-1 \
  --name myapp-hail \
  --existing-rule-set shared-inbound \
  --out infra/hail
```

Choose `--dns route53 --zone-id YOUR_PUBLIC_HOSTED_ZONE_ID` for Route53. Choose `--dns manual` and omit `--zone-id` for another provider.

For an AWS account/region with **no active receipt rule set**, replace `--existing-rule-set shared-inbound` with `--activate-new-rule-set`. The CLI checks the active set and refuses to replace it. The Terraform module defaults to no activation; direct Terraform use still requires you to review current AWS/DNS state and the plan.

`init` performs read-only AWS/DNS checks, then generates ordinary Terraform files. By default, the receiver module source uses the Git tag matching the installed package version (for example `v0.1.0` for Hail `0.1.0`); that tag must exist in the repository before Terraform can download it. Use `--local-modules` to copy the bundled module instead, such as when installing from an unreleased checkout. `--out` selects the output directory and `--file` selects the Terraform filename inside it (default `main.tf`). Existing directories are allowed, but existing generated files are never overwritten. An existing `.gitignore` is preserved; ensure it excludes Terraform variables, state, and plans. `init` never runs `terraform apply` or creates sender identities. It refuses domains with existing MX records. Existing receiver users should attach their configuration rather than rerun initialization.

Edit `infra/hail/terraform.tfvars.json` to configure `reader_principal_arns`, or attach the exported `reader_policy_arn` to your existing developer/CI role. Review your infrastructure naming, region, retention, and state backend before applying.

```bash
terraform -chdir=infra/hail init
terraform -chdir=infra/hail plan
terraform -chdir=infra/hail apply
npx hail configure --terraform-dir infra/hail
npx hail doctor
```

Manual DNS mode prints the required MX and TXT records with `terraform output dns_records`. Publish them before running `doctor`. Managed modes wait for SES identity verification, which can take time after DNS changes. DNS tokens and AWS credentials never belong in tfvars or Git.

`doctor` checks resolved MX, SES identity, the active domain/bucket receipt rule, and S3 listing access. It does **not** verify all preceding SES rules, queue health, raw-object read permissions, or actual delivery. Use the live test gate and check the DLQ before calling a deployment validated.

For an already deployed receiver, [`hail smoke`](docs/CLI.md#hail-smoke) sends one synthetic message to a fresh test inbox with separate short-lived sender and reader credentials, waits up to a configured deadline, and checks its content. It is invoked explicitly and never runs in `doctor` or ordinary CI. Check the ingestion DLQ separately after a live run.

## Write a Playwright test

Set Playwright's `use.baseURL` to your application. Replace selectors and expected states with your app's actual contract.

```typescript
import { test, expect, visitAuthLink } from "@everydaydevopsio/hail/playwright";

test("sign in using the delivered magic link", async ({ page, inbox }) => {
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
  await visitAuthLink(
    page,
    email.getLink({ text: /sign in/i, allowedOrigins: [origin] }),
  );
  await expect(page.getByTestId("current-user-email")).toHaveText(
    inbox.address,
  );
});
```

Continue magic-link flows in the requesting browser when your app binds a request nonce to a cookie. Invitation recipes must use separate administrator and invitee contexts. Seed authorized test users through your test setup when the application disallows arbitrary signup; do not relax production authentication.

### Core API

```typescript
import { Hail, loadConfig } from "@everydaydevopsio/hail";
const hail = new Hail(await loadConfig());
const inbox = hail.createInbox("login");
const after = await inbox.checkpoint();
// Trigger your application's send here.
const email = await inbox.waitForEmail({ after, subject: /sign in/i });
const code = email.getCode(); // Only for a message containing a single distinct code.
```

`waitForEmail` and `waitForEmails(count, options)` support `after`, `subject`, `from`, `timeoutMs`, `pollIntervalMs`, `signal`, and `consume`. String filters match exactly; regex filters match patterns. Messages are consumed within an Inbox instance by default. Use a separate inbox for concurrent actors; concurrent waits on the same Inbox are not a transactional queue.

`inbox.expectNoEmail({ forMs: 2000, subject: /unexpected/i })` asserts that no matching message was observed during that window, not that none will ever arrive.

`email.getLink({ allowedOrigins, text?, pathname? })` requires one distinct matching HTTP(S) URL and preserves signed URL encoding after normal HTML decoding. It does not follow redirects, rewrite tracking links, or change production URLs to localhost. Only allow origins you trust; redirect destinations remain the application's responsibility.

`email.text`, `email.html`, `email.attachments`, `email.receivedAt`, and `email.delivery` are available for explicit assertions. Received timestamps come from SES metadata, not the sender-controlled Date header. New storage supports up to 16 MiB per message; oversize messages fail ingestion into the DLQ.

## Attach to an existing receiver

For a Hail receiver, obtain the `hail_config` Terraform output and reader-role access. A developer does not need infrastructure or DNS write permission to run tests.

For the original recipient-folder layout, use this configuration:

```json
{
  "schemaVersion": 1,
  "domain": "email-test.example.com",
  "bucketName": "your-existing-ses-bucket",
  "region": "us-east-1",
  "layout": "legacy"
}
```

An optional `roleArn` uses refreshable assumed-role credentials. Legacy layout uses `<recipient>/<message-id>.eml` and S3 LastModified timestamps; it lacks the trusted SES receipt metadata of `indexed-v1`. Prefer fresh per-test addresses rather than reused legacy mailboxes. Importing source code does not migrate any deployed Terraform state or activate a new receiver.

## Live delivery gate

For a disposable Cloudflare receiver and the complete local/live/cleanup sequence, use the [one-command live runner](docs/LIVE-RUNNER.md):

```bash
npm run test:live:full -- --profile hail-bootstrap --domain example.com --region us-east-1 --execute
```

This explicitly provisions resources and sends synthetic email. Select the approved profile/domain and install prerequisites first; it is never invoked by ordinary PR CI.

See [live verification](docs/LIVE-VERIFICATION.md). The live suite uses the same browser scenarios, but sends email through an explicitly configured SES sender and reads the actual receiver. It requires a deployed receiver, verified sender, appropriately restricted AWS credentials, and explicit invocation. The existing `npm run test:live` browser suite requires that receiver to be provisioned already; `test:live:full` above manages its own disposable receiver.

SES receipt proves delivery to this SES inbox, not Gmail/Outlook inbox placement or native email-client rendering. A live run against the demo application is not a substitute for running the generated recipe against your own application.

## Security and scope

Read [security and operations](docs/SECURITY.md) before granting access or enabling live CI. Raw MIME and authentication links are secrets. Hail does not auto-attach them; Playwright navigation failures and third-party logging may still include URLs. Disable auth traces/screenshots by default and keep live CI output restricted.

A hosted inbox viewer, local SMTP server, provider-specific delivery event adapters, full diagnostic queue inspection, and an MCP server are future work, not features of this PR.

## Provenance

Hail evolves [ses-email-client](https://github.com/markcallen/ses-email-client) and [ses-receiving-terraform](https://github.com/markcallen/ses-receiving-terraform). Complete unchanged snapshots are retained under `upstream/`; their historical docs are not the supported Hail setup guide. See [the exact imported commits](docs/UPSTREAM.md).

## Contributor checks

Run `make deps`, then `make setup`. Source `.dev-tools/activate` or run `make shell`; run `make check` for local validation. Setup reports missing tools and directs you to `make deps`. See the [documentation index](docs/README.md) and [development checks](docs/DEVELOPMENT.md).

## License

MIT — see [LICENSE](LICENSE).
