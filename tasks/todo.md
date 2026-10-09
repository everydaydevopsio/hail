# Task: npm release workflow

## Context
- Date: 2026-10-09
- Mode: Autonomous implementation; dispatching a real publish still requires explicit authorization.
- PRD Section: npm release channel (REL-01 through REL-04).

## Scope
- In scope: release CI, version-safe packed tests, release operations documentation.
- Out of scope: triggering publication, live AWS/DNS operations, immutable upstream snapshots.

## Acceptance Criteria
- Manual patch/minor/major release starts only on main, validates source, pushes matching manifests and tag, publishes with provenance, and creates a GitHub Release.
- Retry uses the existing tag and cannot bump again.
- CI packed tests support any package version.

## Constraints
- Preserve npm lockfile, ISC license, credential-free PR CI, and `v`-tagged versions.

## Risks and Tradeoffs
- Registry failure can leave a tag without a package; use the documented tagged retry.
- The first dispatch requires npm trusted publisher and a GitHub release environment configured by the operator.

## Execution Checklist
- [x] Review Pilot and update PRD requirements.
- [x] Add release workflow and version-independent CI artifact checks.
- [x] Document release operation and failure recovery.
- [x] Verify actionlint, local suites, and Terraform tests. Full WebKit execution was attempted but this host lacks WebKit shared libraries; release CI installs them before running the gate.

## Test Strategy
- Static: actionlint and Prettier check for workflows.
- Local: existing TypeScript, Python, browser, package, and Terraform gates.
- Failure paths: invalid retry tag, non-main dispatch, version mismatch, and failed git push stop before publish.
- Requirement mapping: release workflow guards REL-01/02/04; npm job REL-03.

## Rollback Strategy
- Before dispatch, revert the workflow and docs commit.
- After tag but before npm publish, fix the failed gate and retry the existing tag if appropriate.
- npm package versions cannot be unpublished as a normal rollback; issue a corrective version.

## Outcome
- `actionlint`, Prettier, typecheck, build, lint, 46 Node tests, 42 Python tests, package audit, coverage (97.43% lines), and all five Terraform validate/mock roots passed.
- Browser suite: 18 Chromium/Firefox cases passed; nine WebKit cases could not launch because system libraries are absent. The workflow installs all three engines and their dependencies in CI.
- npm publication and GitHub Release creation were not invoked. Operator must configure npm trusted publishing and the GitHub `npm` environment, then dispatch the workflow.

# Previous task: Ballast audit and rule compliance

## Current task: versioned initializer

- Mode: Autonomous implementation of the requested CLI behavior; no infrastructure changes.
- PRD: INIT-01 and INIT-02.
- [x] Add failing scaffold tests for Git tag, local module, custom file, and conflicts.
- [x] Implement CLI and scaffold options and update operator docs.
- [x] Run available validation: typecheck, lint, 46 Node tests, 42 Python tests, Chromium E2E (9 tests), package audit, and all five Terraform validate/mock roots passed. Coverage is 97.43% lines, 87.92% branches, and 96.77% functions. Full browser suite blocked by missing host libraries; `make deps` hit an external apt lock.
- Rollback: revert the initializer, test, and documentation changes; no cloud state changes.

## Context
- Date: 2026-10-08
- Mode: Autonomous; PR and merge authorized; Copilot excluded.

## Scope
- In scope: generated rules, evidence-backed config, development gates, audit report.
- Out of scope: live email, provisioning, publishing, upstream snapshots.

## Acceptance Criteria
- All retained rules have repository evidence and appropriate enforcement.
- Clean ownership and generation audit; required tests and PR checks pass.

## Execution Checklist
- [x] Read all rules and establish initial audit evidence.
- [x] Apply narrowed config and compliance fixes.
- [x] Complete required local checks and final audit.
- [x] Record local evidence and graduate the plan; PR Actions and merge are the remaining delivery steps.

## Test Strategy
- Run the existing unit/Python/browser/package and Terraform suites, plus new static gates.
- No product behavior changes; new behavioral tests are unnecessary.

## Rollback Strategy
- Revert this PR; no deployed state changes.

## Outcome
- Historical checklist archived at tasks/archive/validation-plan.md; its old live work is superseded by docs/LIVE-EVIDENCE-20261008.md and is not authorization for another live run.

- Result: 16 applicable rules per target; no drift; make deps/setup/check passed.
- Evidence: [audit](../docs/RULES-AUDIT.md), [ADR 001](../adr/001-rules-and-development-setup.md).
