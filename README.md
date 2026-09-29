# Hail

**Send. Receive. Verify.**

A Playwright-native toolkit for testing magic-link logins, invitations, one-time codes, and application email delivery using an AWS SES receiver that you control.

## Starting point

Hail brings together Mark Allen's existing projects:

- [ses-receiving-terraform](https://github.com/markcallen/ses-receiving-terraform): SES receiving, S3 storage, IAM, and recipient processing.
- [ses-email-client](https://github.com/markcallen/ses-email-client): TypeScript MIME parsing and email retrieval for end-to-end tests.

The initial import is a source baseline, **not a validated Hail release**. The integration pull request adds the developer-facing package, automated tests, and safe infrastructure templates. No npm release or live cloud deployment is implied by this repository's creation.

## Product direction

- Keep the application's existing sending provider.
- Give each Playwright test attempt a unique address on a dedicated test subdomain.
- Provision receiving infrastructure with ordinary Terraform, using Cloudflare, Route53, or manual DNS.
- Support existing SES rule sets without silently changing the active rule set.
- Use one retryable SES-to-SNS-to-SQS-to-Lambda ingestion path, with S3 as the message store.
- Expose a TypeScript client, Playwright fixtures, and a small CLI.
- Parse links without fetching or consuming authentication tokens.
- Separate local workflow tests from actual internet-delivery tests.
- Keep raw emails, authentication URLs, cookies, and codes out of ordinary CI reports.

Receipt at the test SES inbox proves receipt there. It does not prove Gmail/Outlook inbox placement or native mail-client rendering.
