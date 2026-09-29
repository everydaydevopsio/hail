# Hail contributor instructions

Hail is an email-workflow testing tool, not a sending provider or authentication service.

- Read README.md and docs/SECURITY.md before changing inbox, auth-link, IAM, or DNS behavior.
- Keep upstream/ immutable. It holds original source snapshots with provenance; do not run its historical deployment examples as the supported Hail path.
- Run npm run typecheck, npm test, npm run test:python, npm run test:e2e, and Terraform validate/mock tests before claiming local validation.
- Never claim cloud delivery based on mocks, an in-memory store, terraform validate, or doctor. Record separate live evidence per docs/LIVE-VERIFICATION.md.
- Do not provision resources, send real email, publish packages, replace MX records, or activate SES rule sets without explicit authorization.
- Never fetch or consume an authentication URL while extracting links. Never attach raw mail, codes, cookies, or auth URLs to normal reports.
- CI for pull requests must remain credential-free and read-only. Live tests are explicitly invoked using protected credentials.
- Preserve unique per-attempt inboxes, server receipt timestamps, bounded waits, partial-batch retries, and separate invitee browser contexts.
