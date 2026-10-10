# Validation lessons

Record repeatable failure patterns and the test or gate that catches them here.

- A new SES operator command must use the action allowed by the existing restricted sender policy. The live role grants `ses:SendRawEmail`; review IAM scope before choosing the SES SDK command.
- Node subprocess coverage and browser startup can fail under the command sandbox while ordinary unit tests pass. Re-run the exact affected gate outside the sandbox after an `EPERM` or browser sandbox error, and report missing host browser libraries separately.

- Replacing top-level CLI help while adding subcommand help can silently remove existing usage details. Keep the top-level help regression test and check it alongside each new command help path.

- A grouped major dependency bump can select a compiler newer than its lint parser supports. Dependabot's TypeScript 7 update failed `npm ci` because `typescript-eslint` 8 accepts TypeScript below 6.1. Keep compiler updates within the parser's peer range and use the repository's minimum Node major for published `@types/node` declarations.

- A deadline can coincide with an unrelated S3 failure. The negative-email regression waits past the deadline and requires the storage error to propagate.
- Package `files` allowlisting a whole Terraform tree included generated `.terraform` and Python bytecode despite top-level `.npmignore` patterns. The package audit now checks the actual npm file list and required files.
- Public declarations referenced Node types. A clean consumer typecheck caught the undeclared dependency; `@types/node` is now a package dependency.
- Playwright's TypeScript transform treated an untyped temporary package as CommonJS and could not load Hail's ESM-only export. The clean consumer browser gate now uses `"type": "module"` explicitly.
- Browser and Node subprocess tests inside a mount namespace need `/proc` and `/dev`; the command sandbox can still prohibit child process or browser operations, so a passing exit with incomplete output is not evidence. Require final test counts.
- A failed-navigation test targeting an unreachable port can hang until the browser's navigation timeout, especially in WebKit. Intercept and abort a synthetic token URL on the loopback app, then assert the sanitized error.
- Terraform's mock data defaults did not populate an optional Route53 `private_zone` input; the test uncovered a null guard value. Filter the data source to public zones explicitly so both the mock plan and real lookup fail closed.
- Separate identity checks do not prove role separation unless the configured ARNs are compared. Validate reader and sender roles before either live session is used.
- `Date.parse` can return `NaN`, and a comparison against `NaN` is false. Require a finite timestamp before admitting a short-lived session.
- A centrally counted `ses.send` call can still make multiple API attempts through SDK retries. Keep SES `maxAttempts` at one and count every application attempt before calling it.
