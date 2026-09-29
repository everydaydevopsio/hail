# Live verification gate

Local CI is necessary but insufficient. A release is not verified for email delivery until this gate passes in a real AWS/DNS environment.

## Before the run

1. Select a dedicated test subdomain and a supported receiving region. Run `hail init` against an existing authoritative Cloudflare or public Route53 zone, or use manual DNS. Review and apply Terraform yourself. Never overwrite the company domain's MX records.
2. Grant the test identity the exported reader policy. If `hail_config.roleArn` is set, also grant permission to assume it and configure its trust policy. Keep infrastructure provisioning credentials separate from test credentials.
3. Configure a verified SES sender and scoped `ses:SendRawEmail` access for the live demonstration suite. Receiving does not require Hail to become the application's sending provider. In a sandboxed SES sending account/region, verify the test recipient domain there too or obtain appropriate production sending access.
4. Run `hail configure --terraform-dir infra/hail`, then `hail doctor`. Check the ingestion queue/DLQ separately. Existing active receipt rules that run first must not stop, bounce, or redirect these messages.

## Run locally

```bash
npm ci
npm run build
npx playwright install --with-deps chromium
export HAIL_CONFIG=/absolute/path/to/hail.config.json
export HAIL_FROM=verified-test-sender@example.com
# Optional when the sender is in a different SES region:
export HAIL_SEND_REGION=us-east-1
npm run test:live
```

This sends synthetic messages to randomly generated addresses in the configured test domain. The localhost link inside the email is followed by the same runner's browser; no public demo app deployment is required.

The checked-in live workflow is manual-only. Configure a protected GitHub environment named `hail-live`, with required reviewers and allowed deployment branches. It expects:

- Repository/environment variable `HAIL_AWS_ROLE_ARN`: tightly scoped OIDC role. Use the actual GitHub OIDC subject for this repository and environment in AWS trust conditions; do not trust arbitrary repositories, refs, or fork code.
- Variable `AWS_REGION` for the test identity and receiving configuration.
- Variable `HAIL_FROM` for the verified synthetic sender, and optional `HAIL_SEND_REGION`.
- Environment secret `HAIL_CONFIG_JSON`: the Terraform `hail_config` object as JSON, not the entire Terraform state.

Run the workflow only after reviewing and merging the integration PR. It uses no Terraform apply and publishes no package. Never grant live credentials to untrusted pull requests. In a public repository, review your Actions log visibility before using reusable accounts; the workflow deliberately avoids automatic reports or authentication traces but cannot guarantee that all dependencies redact errors.

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
