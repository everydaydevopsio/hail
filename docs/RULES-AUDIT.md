# Ballast audit and compliance review — 2026-10-08

The initial review read every installed rule, then ran all five checks in the
[ballast-audit skill](../.codex/skills/ballast-audit/SKILL.md). The final review
repeated ownership, clean generation, fit, density, and manifest checks after
regeneration and development-gate changes. No Copilot was invoked. No cloud
resources, mail, DNS records, registry packages, or live workflows were changed.

## Baseline and scope

The starting working tree already contained an uncommitted Ballast installation;
this change preserves the Hail contributor instructions and commits a reviewed,
narrower installation. Wrapper, TypeScript backend, Go/Terraform backend, and
`ballastVersion` were all **5.21.3**. No backend upgrade was needed.

| Setting | Initial | Final |
| --- | --- | --- |
| targets | codex, claude | unchanged |
| agents | local-dev, docs, cicd, observability, publishing, git-hooks, tasks, plan-lifecycle, spec-kit, testing-process, core, linting, logging, testing | local-dev, docs, cicd, git-hooks, tasks, plan-lifecycle, testing-process, core, linting, testing |
| skills | ballast-audit | unchanged |
| languages | typescript, terraform | unchanged |
| TypeScript paths | `.`, `upstream/ses-email-client` | `.` |
| Terraform paths | five maintained roots plus `upstream/ses-receiving-terraform` | five maintained roots plus root tooling config (`.`) |
| discovery exclusions | absent | `upstream`, `.dev-tools` |
| TypeScript tools | pnpm, corepack | npm (matches lockfile, CI, README) |
| Terraform tools | tfenv, tflint, trivy | unchanged |
| taskSystem | github | unchanged |
| deploymentModel | none | unchanged; no automatic deployment/release owner |
| publishingProfiles | unset (emits all four default variants) | unset; publishing agent removed |

The five maintained roots are `terraform/bootstrap`, `terraform/modules/receiver`,
and `terraform/examples/{cloudflare,route53,manual}`. Python worker/runner tests
remain covered by the repository instructions, shared testing-process rule, and
existing Python CI; no unrelated Python framework migration is introduced.

## Always-on cost

Counts recurse through nested rule directories. Totals include the target's
manifest and divide bytes by four for approximate tokens; skill bodies are on
demand and excluded. Target-specific prose is expected, not duplicate context.

| Target | Initial rules | Initial manifest | Initial total / tokens | Final rules | Final manifest | Final total / tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Codex | 68,725 B | 3,930 B | 72,655 B / 18,164 | 48,282 B | 4,111 B | 52,393 B / 13,098 |
| Claude | 69,004 B | 3,851 B | 72,855 B / 18,214 | 48,561 B | 3,124 B | 51,685 B / 12,921 |

Each target drops from 25 to 16 rules, saving **20,443 rule bytes**. Hail-specific
applicability instructions add useful manifest context rather than editing
canonical generated rule bodies.

## Findings, largest first

Byte costs below are per target unless stated otherwise. Paths are relative to
`.codex/rules/` or `.claude/rules/`.

1. **Irrelevant current publishing procedures — 13,491 B (check 3).**
   `common/publishing.md` (5,076), `publishing-apps.md` (2,730),
   `publishing-cli.md` (2,796), `publishing-libraries.md` (1,532), and
   `publishing-sdks.md` (1,357). Hail has a CLI and typed package, but no registry
   publish workflow or released package. Removed `publishing`, rather than
   adding release automation merely to justify rules. This loses detailed
   bump/tag and registry procedures; `core` retains tagged-release/version
   invariants, `AGENTS.md` retains explicit publishing authorization, and CI
   retains packed-consumer checks. Re-enable only the appropriate profiles when
   an actual release channel is introduced. An empty profiles array is not used.
2. **Logging architecture mismatch — 4,634 B (check 3).**
   `typescript/typescript-logging.md` (2,846) prescribes Pino/browser forwarding
   for a repository whose TypeScript product is a client/CLI, not a resident
   application. Removing the shared `logging` selector also removes
   `terraform/terraform-logging.md` (1,788). Preserve its applicable secret/debug
   constraints in Hail's authored `AGENTS.md`; `terraform-linting`, the existing
   security runbook, and named CI steps retain the remaining relevant guidance.
   The Python worker's existing safe logging and CloudWatch retention stay intact.
3. **Canonical drift — 3,766 B affected (checks 1–2).**
   `common/core.md` (1,632 initially) omitted Terraform commands;
   `common/git-hooks.md` (2,134 initially) selected TypeScript-only Husky rather
   than mixed-repository pre-commit. Both targets had these mismatches. The
   initial doctor census was 46 ok, 4 drifted, **0 unowned, 0 stale**. A clean
   install reproduced 25 files per target with two content differences and no
   missing/orphan files. Rule byte totals happened to be equal (delta 0 B);
   a zero size delta alone does not establish equality. Canonical regeneration
   fixes drift. This is not an old-marker-version finding.
4. **Placeholder observability rule — 1,232 B (check 4).**
   `common/observability.md` contains goals/scope and explicitly says its
   instructions will be expanded later. Lambda/CloudWatch is real, but this
   placeholder adds no concrete operational procedure. Removed its selector;
   `docs/SECURITY.md`, `docs/LIVE-VERIFICATION.md`, and worker tests retain
   actual operational obligations.
5. **Inactive Spec Kit rule — 1,086 B (check 3).**
   `common/spec-kit.md` has no `.specify/` evidence. Removed `spec-kit`.
   `PRD.md`, `plan-lifecycle`, `tasks`, and `testing-process` retain requirements,
   planning, traceability, and test-first behavioral-change discipline; only
   unused Spec Kit-specific lifecycle guidance is lost.
6. **Discovery and tool mismatch (check 3).** Ballast rediscovered immutable
   `upstream/` paths after a simple paths edit. Scratch testing verified
   `discovery.excludePaths` prevents this. A separate experiment showed explicit
   `ruleProfile: minimal` suppresses the selected detailed rules, so it was not
   added. npm replaces the unused pnpm/corepack preference. No upstream file
   changed, and no new package-manager lockfile was introduced.

No rule exceeded 5,120 bytes, no duplicate body existed within either target,
no target rule-set mismatch existed, and every indexed rule/skill path existed
(checks 4–5). Unowned file list: **empty; 0 bytes**. Stale means owned but outside
the active set; none remain. Removed irrelevant rules were pruned by regeneration.

## Exact remediation and reproduction

A destructive directory reinstall was unnecessary: all rules were owned.
The clean baseline showed drift, so refresh owned outputs with `--force`;
then narrow the config and regenerate. No generated rule or skill was hand-edited.

```bash
# Before narrowing: restore canonical bodies for the original configuration.
ballast install --refresh-config --yes --force

# Apply these config edits (the checked-in .rulesrc.json is the final source).
python3 - <<'PY'
import json
from pathlib import Path
p = Path('.rulesrc.json')
c = json.loads(p.read_text())
c['agents'] = [
    'local-dev', 'docs', 'cicd', 'git-hooks', 'tasks',
    'plan-lifecycle', 'testing-process', 'core', 'linting', 'testing',
]
c['skills'] = ['ballast-audit']
c['tools']['typescript'] = ['npm']
c['discovery'] = {'excludePaths': ['upstream', '.dev-tools']}
c['paths']['typescript'] = ['.']
c['paths']['terraform'] = [
    '.', 'terraform/bootstrap', 'terraform/examples/cloudflare',
    'terraform/examples/manual', 'terraform/examples/route53',
    'terraform/modules/receiver',
]
p.write_text(json.dumps(c, indent=2) + '\n')
PY
ballast install --refresh-config --yes --force
```

In this run the original-config canonical refresh was first established in the
scratch baseline; the repository's drift restoration and config narrowing were
then applied in one regeneration. Wrapper/backend versions matched, so `upgrade`
was not needed. No surviving generated-body trimming was justified.

Final ownership commands:

```bash
ballast --version
ballast doctor
.ballast/tools/typescript/node_modules/.bin/ballast-typescript doctor
.ballast/bin/ballast-go doctor
```

For clean-generation verification, repeat the skill's scratch-copy install,
excluding `.dev-tools/`, `node_modules/`, `.terraform/`, `.git/`, `.ballast/`,
both target directories and manifests. Compare both `rules/` and `skills/`
recursively. The final fresh copy returned **no differences**, with final rule
sizes of 48,282 B (Codex) and 48,561 B (Claude): **baseline delta 0 B**, zero
unowned/drifted/stale rules, 32 owned `ok` files across the two targets. Manifest
references all resolve, and target sets both contain the same 16 rule paths.

The backend's generic suggestion to add publishing merely because `bin` exists
is intentionally not followed: the fit check establishes no current publishing
workflow. Its CLI-PATH discovery message is separate from the wrapper's verified
project-local backend inventory; it does not indicate rule drift.

## Second compliance review: every retained rule

| Rule under each target's `rules/` | Applicability and final evidence |
| --- | --- |
| `common/local-dev-autonomy.md` | Task branch, reversible changes, user-authorized PR/merge; sandbox escalations honored; no unrequested live actions. |
| `common/local-dev-badges.md` | README links real CI and ISC license. Release/npm badges deferred because there is no release channel; explicit applicability recorded in AGENTS. |
| `common/local-dev-env.md` | `.nvmrc`, engines, `make deps/setup/shell/check`, lockfile, generated shell activation; missing tools direct developers to `make deps`. |
| `common/local-dev-license.md` | Existing ISC LICENSE and package license retained; README license link added. |
| `common/docs.md` | Documentation index, development commands, architecture/metadata diagrams, this audit, security/live runbooks. |
| `common/cicd.md` | Credential-free read-only PR jobs; lint/format/coverage gates; weekly grouped Dependabot; concurrency on both workflows. Live workflow remains dispatch-only and protected. |
| `common/git-hooks.md` | Mixed-repository pre-commit config, official Gitleaks hook using installed binary, commit lint/format/HCL checks, push build/typecheck/unit/CLI/package checks. |
| `common/tasks-task-system.md` | GitHub issue list checked (none open); current work tracked in branch TODO and PR; no outstanding follow-up work left only in notes. |
| `common/tasks-todo.md` | Structured branch TODO with acceptance criteria, tests, rollback and outcome; obsolete historical live checklist archived with superseding evidence. |
| `common/plan-lifecycle.md` | Audit/setup plan created and graduated to ADR 001; indexes maintained. |
| `common/testing-process.md` | New setup regression test failed before implementation, then passed; existing Node/Python/Playwright frameworks retained; CLI/package smoke uses real product, no new fake application. |
| `common/core.md` | Task branch before authored changes, generated content rebuilt, no release, traceable checklist, lint and coverage enforcement. |
| `typescript/typescript-linting.md` | ESLint flat config, existing Prettier, JS/TS coverage, npm scripts, CI and hooks; documented narrow Playwright fixture exception. |
| `typescript/typescript-testing.md` | Existing Node runner; 50% line/function/branch gate for loaded source modules; CLI/package smoke and three-browser suite. |
| `terraform/terraform-linting.md` | `.terraform-version`, tfenv installer, AWS TFLint plugin, Trivy, format, backend-free init and lockfile preservation. Maintained roots only. |
| `terraform/terraform-testing.md` | All five roots validated and mock-tested; formatting/lint/security gates fail CI. No credentialed plan/apply in PR jobs. |
| `skills/ballast-audit/SKILL.md` | Invoked for this task; all checks completed before and after, without editing generated files. |

Generic Docker smoke/server instructions do not fit a client/CLI with a Lambda
receiver. Existing demo browser fixtures are retained, not introduced as a new
product service. These application-specific interpretations are explicit in
`AGENTS.md` and linked from `CLAUDE.md`.

## Validation and limits

`make deps` and `make setup` completed on Linux. The installer initially exposed
a read-only shared browser cache; the corrected project-local cache is regression
covered. Setup missing-tool behavior exited before mutation and printed `make
deps`. Shell quoting, command failure, backend-free initialization, hooks, and
inherited live-mode suppression are covered by five new Python tests.

`make check` passed: build, typecheck, lint, format, 43 Node unit tests, the 50%
coverage gate (97.29% lines, about 87.4% branches, 96.77% functions of loaded
source modules), 42 Python tests, 27 browser cases, package audit (28 files),
Terraform formatting, TFLint, Trivy, validation of five roots, and 22 mock tests
(7 bootstrap, 9 receiver, 2 per DNS example). Python tests were rerun after the
final setup safety change. PR Actions provide separate clean-runner evidence.

Trivy gates HIGH/CRITICAL findings with two file-scoped, reasoned exceptions in
`.trivyignore.yaml`: metadata-only SNS without KMS and S3-managed AES256 rather
than a customer KMS key. This does not claim all-severity scan cleanliness or
change either deployed encryption contract. Terraform retains existing provider
deprecation warnings; validation and mock tests pass. macOS installer branches
have not been exercised on a Mac. No new cloud-delivery evidence is claimed.
