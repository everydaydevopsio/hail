# Security and operational boundaries

## Authentication email is a credential

Keep S3 private and use least-privilege roles. Do not attach raw MIME, one-time codes, signed links, cookies, or Playwright storageState to ordinary CI reports. EmailMessage's default JSON/inspect representation omits message bodies and subjects. That does not sanitize arbitrary third-party logs or a failed `page.goto(url)` call. The bundled browser suite disables trace, screenshot, and video capture. Review log access for live runs.

The CLI generates no AWS access keys and never writes DNS tokens into Terraform. Configuration JSON contains only allowlisted noncredential receiver fields and optional role ARN; it is created with owner-only permissions and is gitignored. Terraform state may still contain sensitive infrastructure metadata. Use an access-controlled state backend and preserve its lockfile.

## Isolation

Random per-test addresses protect against accidental collisions, not malicious readers sharing one IAM role. The initial reader policy grants access to raw messages and indexes for its receiver bucket. Deploy separate buckets/roles for unrelated trust boundaries. Never grant fork pull-request code access to a shared auth inbox. Production tests require dedicated least-privilege accounts and an explicit cleanup policy in the application.

The receiver accepts arbitrary local parts on its configured test subdomain, but the initial Hail SDK/indexer intentionally supports simple ASCII test local parts only. Domains must be configured explicitly. Index metadata derives from SES envelope recipients, not the visible To header. Raw email body content remains untrusted input; never execute links, HTML, or attachments just to inspect an email.

## Links and timing

`getLink` parses without fetching; requires a configured allowed origin; rejects credential-bearing URLs and executable schemes; and fails on ambiguity. It does not validate the destination of HTTP redirects. Do not include arbitrary tracking domains in the allowlist. The caller follows the approved link once in the appropriate browser context. Use `visitAuthLink(page, url)` from the Playwright entry point to redact token-bearing URLs from navigation errors.

Checkpoint filtering uses the process clock and SES receipt timestamps in indexed-v1 mode. Keep runner clocks synchronized. Delayed indexing of older mail is excluded by receipt time. S3 overwrite times in legacy mode are less precise; use unique addresses for each attempt. No global read/unread flag is shared between test workers.

Expiry belongs to the backend's clock. The test demo expires tokens in server memory, not via browser clock manipulation. Negative-email assertions apply only to their explicit observation window.

## Receiving infrastructure

Use fresh test subdomains, never apex/company mail domains. The initializer preflights resolved MX and the active SES rule set, but that check is not a lock against concurrent external DNS changes. Review the Terraform plan and existing DNS records again before applying. Cloudflare users who bypass the initializer must independently confirm there are no conflicting MX records. Route53 records set allow_overwrite=false.

Only one regional SES rule set is active. Default module behavior does not change activation. Using an existing set adds a rule but does not make earlier rules safe; inspect any stop/bounce actions and rule ordering. Sender identity verification, DKIM, SPF, custom MAIL FROM, and sandbox access are independent concerns from setting up this receiver.

SNS publishes metadata to SQS; only the worker consumes that queue. Tests list their own recipient index. Partial batch failures retry, and deterministic message IDs keep repeated successful processing harmless. Raw MIME stays immutable in `incoming/` until lifecycle expiry. The initial 16 MiB SDK/worker size cap is intentional; oversized mail retries into the DLQ for diagnosis.

Default mail retention is three days, Lambda logs seven days, ingestion queue three days, and DLQ fourteen days. These stores can retain metadata for different lengths of time. S3 lifecycle expiration is asynchronous. Versioning is not enabled for short-lived auth mail, but noncurrent-version expiry is configured defensively. `force_destroy` is false.

## Permissions and diagnostics

Provisioning requires broader AWS and optional DNS permissions than running tests. The module exports a reader policy and optionally creates a role only for explicit trusted principal ARNs. No wildcard trusted reader principal is created by default. S3 key validation in the client is defense in depth, not a replacement for IAM policies.

For restricted provisioning, set both `external_indexer_role_arn` and `external_reader_role_arn`. In this mode the receiver module creates no IAM roles, policies, or attachments; its Lambda uses the supplied execution role and `hail_config.roleArn` names the supplied reader role. Precreate and review those roles separately before applying. Setting only one ARN or mixing external roles with `reader_principal_arns` is refused. Existing consumers can retain module-managed roles; set `permissions_boundary_arn` to apply a boundary to any roles the module creates. A boundary is only one control: review trust, identity policies, and resource policies as well.

The live browser fixture requires two short-lived, owner-only session files and independently verifies both identities with STS using the same credentials passed to its S3 and SES SDK clients. It strips `roleArn` from the direct-reader Hail configuration to avoid a second assumption. It has a shared 200-attempt send counter across workers and concurrent runs that use the same private run directory. The parent Codex session can still access the source profile; a child process sandbox does not restrict its parent. For stronger agent isolation, start a fresh Codex session in an environment containing only the approved restricted role sessions, with no source `~/.aws`, SSO cache, credential helper, Docker socket, or host credential mount. Setting `AWS_PROFILE` alone does not provide that isolation.

The initial doctor is read-only and reports what it actually checked: DNS MX, SES identity, active matching receipt rule, and recipient-prefix listing. It cannot establish ingestion health, complete rule ordering safety, GetObject access, external sender acceptance, or actual receipt from those checks alone. Inspect the DLQ using an operations identity and run the opt-in live gate.
