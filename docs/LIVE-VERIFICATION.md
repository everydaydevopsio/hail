# Live verification gate

Local CI is necessary but insufficient. A release is not verified for email delivery until this gate passes in a real AWS/DNS environment.

## Before the run

1. Select a dedicated test subdomain and a supported receiving region. Run `hail init` against an existing authoritative Cloudflare or public Route53 zone, or use manual DNS. Review and apply Terraform yourself. Never overwrite the company domain's MX records.
2. Use separate restricted reader and synthetic-sender roles. The browser fixture takes explicit short-lived session files for each and checks their AWS account and role with the same SDK credentials it uses for S3 and SES. The reader session uses direct S3 access; test the optional `roleArn` assumption separately from an authorized restricted source.
3. Configure a verified SES sender and scoped `ses:SendRawEmail` access for the live demonstration suite. Receiving does not require Hail to become the application's sending provider. In a sandboxed SES sending account/region, verify the test recipient domain there too or obtain appropriate production sending access.
4. Run `hail configure --terraform-dir infra/hail`, then `hail doctor`. Check the ingestion queue/DLQ separately. Existing active receipt rules that run first must not stop, bounce, or redirect these messages.

## Run locally

For a persistent, already deployed receiver, use the one-message [`hail smoke` command](CLI.md#hail-smoke) with separate restricted reader and sender session files. After it passes, check the receiver's ingestion DLQ with the diagnostics role and record an empty queue result. This command does not run the browser scenarios or create/destroy infrastructure. It requires separate explicit authorization to send real email.

```bash
npm ci
npm run build
npx playwright install --with-deps chromium
export HAIL_CONFIG=/absolute/path/to/hail.config.json
export HAIL_FROM=verified-test-sender@example.com
export HAIL_SEND_REGION=us-east-1
export HAIL_EXPECTED_ACCOUNT=123456789012
export HAIL_READER_ROLE_ARN=arn:aws:iam::123456789012:role/hail-run-reader
export HAIL_SENDER_ROLE_ARN=arn:aws:iam::123456789012:role/hail-run-sender
export HAIL_READER_SESSION_FILE=/private/hail-run/reader.json
export HAIL_SENDER_SESSION_FILE=/private/hail-run/sender.json
export HAIL_LIVE_RUN_DIR=/private/hail-run
npm run test:live
```

Each session file is mode 0600 and contains `accessKeyId`, `secretAccessKey`, `sessionToken`, and ISO 8601 `expiration` from an approved restricted STS assumption. The private run directory is mode 0700 and is shared by all workers and repeat runs to enforce the 200-send limit. Do not put the powerful bootstrap profile in the browser process, its environment, its home directory, or any mounted credential helper. Keep the run directory private and delete session files after the phase.

This sends synthetic messages to randomly generated addresses in the configured test domain. The localhost link inside the email is followed by the same runner's browser; no public demo app deployment is required.

The checked-in live workflow is manual-only. Configure a protected GitHub environment named `hail-live`, with required reviewers and allowed deployment branches. It expects:

- Environment variables `HAIL_READER_ROLE_ARN` and `HAIL_SENDER_ROLE_ARN`: separate, tightly scoped OIDC roles. Use the actual GitHub OIDC subject for this repository and protected environment in AWS trust conditions; do not trust arbitrary repositories, refs, or fork code.
- Environment variable `HAIL_EXPECTED_ACCOUNT`: the approved 12-digit AWS account ID checked by the live fixture for both roles.
- Variable `AWS_REGION` for the test identity and receiving configuration.
- Variable `HAIL_FROM` for the verified synthetic sender, and optional `HAIL_SEND_REGION`.
- Environment secret `HAIL_CONFIG_JSON`: the Terraform `hail_config` object as JSON, not the entire Terraform state. The workflow removes its `roleArn` for direct reader-session testing and writes a private temporary file.

Run the workflow only with restricted reader and sender identities in the protected environment. It uses no Terraform apply and publishes no package. Never grant live credentials to untrusted pull requests. In a public repository, review Actions log visibility before using reusable accounts; the workflow avoids automatic reports and authentication traces but cannot guarantee that all dependencies redact errors.

## Evidence required before release

Record the exact code commit, AWS account/region (redact where needed), DNS mode, `doctor` results, workflow URL, and outcome of each scenario:

- Real magic-link delivery; intended user authenticated; used link rejected.
- Invitation delivered; separate invitee browser; correct organization and viewer role; administrator identity remains unchanged.
- Expired server-side token rejected without creating a session.
- Revoked invitation rejected without creating a session.
- Distinct recipient addresses isolated across independent tests.

Repeat a real setup/plan/apply and happy-path run for both Cloudflare and Route53 before claiming both DNS provisioning paths are live-validated. Terraform validate and provider-mocked tests do not establish that IAM permissions, DNS propagation, regional SES behavior, or provider API operations work in a real account.

## Cleanup

Messages expire through S3 lifecycle (default three days), not immediate test teardown. Queue/DLQ metadata and logs have separate retention periods. Clean demo users only inside your application's test database, not through blanket inbox deletion. Terraform leaves a nonempty email bucket intact; deliberately purge test mail before destroying the receiver, and account for delayed lifecycle deletion.
