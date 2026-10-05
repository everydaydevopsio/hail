# Validation lessons

Record repeatable failure patterns and the test or gate that catches them here.

- A deadline can coincide with an unrelated S3 failure. The negative-email regression waits past the deadline and requires the storage error to propagate.
- Package `files` allowlisting a whole Terraform tree included generated `.terraform` and Python bytecode despite top-level `.npmignore` patterns. The package audit now checks the actual npm file list and required files.
- Public declarations referenced Node types. A clean consumer typecheck caught the undeclared dependency; `@types/node` is now a package dependency.
- Playwright's TypeScript transform treated an untyped temporary package as CommonJS and could not load Hail's ESM-only export. The clean consumer browser gate now uses `"type": "module"` explicitly.
- Browser and Node subprocess tests inside a mount namespace need `/proc` and `/dev`; the command sandbox can still prohibit child process or browser operations, so a passing exit with incomplete output is not evidence. Require final test counts.
