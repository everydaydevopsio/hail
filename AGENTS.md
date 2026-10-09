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

## Hail rule applicability

- Developer onboarding uses `make deps` to install tools and `make setup` to prepare the shell, hooks, and providers. If setup reports missing tools, direct the user to `make deps`.
- Use the existing npm lockfile and Node test runner; do not migrate package managers or test frameworks to satisfy generic examples.
- The receiver is deployed as Lambda, not a resident TypeScript/browser application. Existing demo browser workflows are test fixtures; do not create a Docker smoke app or browser logging endpoint.
- PR checks use Terraform mock tests, never credentialed plans. Live operations retain the explicit authorization requirements above.
- Release/npm badges and publishing automation become applicable only when a release channel exists. Keep the MIT license.
- Keep TF_LOG disabled in normal automation; transient debug output and plan files are sensitive and must stay out of ordinary reports.
- See docs/RULES-AUDIT.md for the per-rule compliance evidence.

## Installed agent rules

Created by Ballast. Do not edit this section.

### Repository Tool Policy

- Check `.rulesrc.json` `tools` before adding, installing, or running language tooling.
- Configured tools: terraform=tfenv,tflint,trivy; typescript=npm.

Read and follow these rule files in `.codex/rules/` when they apply:

- `.codex/rules/common/local-dev-autonomy.md` — Rules for common/local-dev-autonomy
- `.codex/rules/common/local-dev-badges.md` — Rules for common/local-dev-badges
- `.codex/rules/common/local-dev-env.md` — Rules for common/local-dev-env
- `.codex/rules/common/local-dev-license.md` — Rules for common/local-dev-license
- `.codex/rules/common/docs.md` — Rules for common/docs
- `.codex/rules/common/cicd.md` — Rules for common/cicd
- `.codex/rules/common/git-hooks.md` — Rules for common/git-hooks
- `.codex/rules/common/tasks-task-system.md` — Rules for common/tasks-task-system
- `.codex/rules/common/tasks-todo.md` — Rules for common/tasks-todo
- `.codex/rules/common/plan-lifecycle.md` — Rules for common/plan-lifecycle
- `.codex/rules/common/testing-process.md` — Rules for common/testing-process
- `.codex/rules/common/core.md` — Rules for common/core
- `.codex/rules/typescript/typescript-linting.md` — Rules for typescript/linting
- `.codex/rules/typescript/typescript-testing.md` — Rules for typescript/testing
- `.codex/rules/terraform/terraform-linting.md` — Rules for terraform/linting
- `.codex/rules/terraform/terraform-testing.md` — Rules for terraform/testing

## Installed skills

Created by Ballast. Do not edit this section.

Read and use these skill files in `.codex/skills/` when they are relevant:

- `.codex/skills/ballast-audit/SKILL.md` — audit a Ballast installation for stale, unowned, oversized, and irrelevant rules and skills, and report the narrowest config that still covers the repository
