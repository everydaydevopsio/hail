# Task: compatible TypeScript dependency update

## Context

- Date: 2026-10-09
- Mode: Autonomous; user requested repair of remaining Dependabot PRs.
- Requirement: Keep the repository installable and its Node 22 minimum supported.

## Acceptance Criteria

- `npm ci` resolves without bypassing peer dependency checks.
- Build, typecheck, lint, coverage, unit, Python, package, and browser gates pass.

## Execution Checklist

- [x] Replace TypeScript 7 with TypeScript 6, the newest major supported by `typescript-eslint` 8.
- [x] Keep published Node types on the supported Node 22 baseline.
- [x] Regenerate the npm lockfile and run local validation.

## Test Strategy

- The original Dependabot CI failure is the failing install case.
- Re-run `npm ci`, quality gates, and Chromium/Firefox browser tests locally; require full PR CI after push.

## Rollback Strategy

- Revert this dependency PR if the fresh CI run fails or compatibility regresses.

## Outcome

- `npm ci`, build, typecheck, lint, Prettier, coverage (97.43% lines), 46 Node tests, 42 Python tests, package audit, and 18 Chromium/Firefox browser cases passed locally. Full three-browser and Terraform checks remain gated by PR CI.

# Previous task: npm-first quickstart

## Context

- Date: 2026-10-09
- Mode: Documentation change requested by the user.
- PRD Section: Acceptance criteria, DOC-01.

## Scope

- In scope: Published-package quickstart, existing-stack checks, state separation, post-apply verification.
- Out of scope: CLI and Terraform module behavior; live cloud operations.

## Acceptance Criteria

- A new user can install a published package and generate the matching tagged module without switching to a source checkout.
- The guide explains how to identify active SES rules and keep Hail state separate from an existing Terraform root.
- The source-checkout alternative remains available.

## Execution Checklist

- [x] Check the published CLI and generated files against a real `v0.1.2` deployment.
- [x] Update the quickstart and governing acceptance criterion.
- [x] Verify commands, flags, links, and Markdown formatting.

## Test Strategy

- Documentation: compare commands and paths with Hail CLI help and generated output.
- Formatting: run Prettier on changed Markdown files.

## Rollback Strategy

- Revert this documentation commit; no infrastructure is changed by the PR.

## Outcome

- The published-package path now leads the guide. Source installation is an explicit alternative. Preflight and state separation steps reflect the `hail.markcallen.dev` setup; no live operation was run from this branch.
- Deferred CLI help, provider warning, and persistent-receiver smoke-test work to issues #24, #25, and #26.
- Local checks passed: build, lint, Prettier, typecheck, 46 Node unit tests, 42 Python tests, package audit, coverage (97.43% lines), Terraform format, and 18 Chromium/Firefox browser cases. The nine WebKit cases could not launch because this host lacks GTK/GStreamer and related libraries; CI installs browser dependencies and is the full-browser gate.

# Previous task: Castoff release notes

## Context
- Date: 2026-10-09
- Mode: Autonomous; the user explicitly requested this release workflow change.
- PRD Section: npm release channel, REL-07.

## Scope
- In scope: Castoff notes and changelog in the manually dispatched release workflow; release operations documentation.
- Out of scope: dispatching a release, publishing npm, changing live AWS/DNS behavior.

## Acceptance Criteria
- A new release fails before tagging when the OpenAI key is unavailable or Castoff fails.
- The release commit includes matching npm manifest versions and a Castoff changelog entry; GitHub Release uses the generated notes.
- Tagged retries do not rewrite their tag or changelog and retain a release-note fallback.

## Constraints
- Preserve npm lockfile, credential-free PR CI, atomic release commit and tag push, and the existing retry flow.

## Risks and Tradeoffs
- Castoff adds an external API dependency to manual release dispatch; a failure must leave no release tag.
- The key must be available to this repository as an Actions secret; the workflow cannot verify repository secret configuration locally.

## Execution Checklist
- [x] Add Castoff generation and changelog writing before the release commit and tag.
- [x] Use Castoff notes for a new GitHub Release, with retry fallback.
- [x] Document secret setup and retry behavior.
- [x] Run workflow lint and repository validation gates.

## Test Strategy
- Static: actionlint and Prettier on the workflow.
- Integration: manual release dispatch with a configured key is needed to prove Castoff API and GitHub Release behavior.
- Failure paths: missing key and action failure stop before version commit/tag; retry skips Castoff.
- Requirement mapping: REL-07.

## Rollback Strategy
- Before dispatch, revert this branch. After dispatch, preserve any published tag/package and correct with a later version.

## Outcome
- `actionlint`, Prettier, build, typecheck, lint, 46 Node tests, 42 Python tests, package audit, and all five Terraform validate/mock roots passed. Coverage: 97.43% lines, 87.97% branches, 96.77% functions.
- Chromium and Firefox E2E: 18 passed. Full E2E was attempted; WebKit cannot launch on this host because system libraries are absent. The release workflow installs those dependencies in CI.
- The Castoff API and GitHub Release path require a future authorized manual release dispatch and configured `OPENAI_API_KEY`. Secret presence could not be inspected with current GitHub permissions.

# Previous task: MIT license

- [x] Replace the root license with the standard MIT text and retain the copyright holder.
- [x] Align npm manifests, README, and contributor guidance with MIT.
- [x] Run credential-free validation and verify the license metadata.
- Rollback: revert this branch before merge; `upstream/` snapshots remain untouched.
- Evidence: build, lint, format, typecheck, 46 Node tests, 42 Python tests, package audit, five Terraform validates, and five Terraform mock suites passed. Browser tests passed on Chromium and Firefox (18 cases); WebKit could not launch because this host lacks its system libraries.

# Previous task: npm release workflow

## Context
- Date: 2026-10-09
- Mode: Explicit user authorization to publish the first npm package version.
- PRD Section: npm release channel (REL-01 through REL-04).

## Scope
- In scope: release CI, version-safe packed tests, release operations documentation.
- Out of scope: triggering publication, live AWS/DNS operations, immutable upstream snapshots.

## Acceptance Criteria
- Manual patch/minor/major release starts only on main, validates source, pushes matching manifests and tag, publishes with provenance, and creates a GitHub Release.
- Retry uses the existing tag and cannot bump again.
- CI packed tests support any package version.
- First-publication dispatch creates the tag without attempting unavailable npm trusted publishing; an npm organization owner publishes the tagged artifact.

## Constraints
- Preserve npm lockfile, ISC license, credential-free PR CI, and `v`-tagged versions.

## Risks and Tradeoffs
- Registry failure can leave a tag without a package; use the documented tagged retry.
- The first publish uses the authenticated npm owner; trusted publishing becomes available after the package exists.

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
- npm owner authentication verified as `markcallen`. PR #22 merged after all CI jobs passed; merged-main CI passed. Bootstrap release run created `v0.1.1` at `17866c41ee2b0814db7b70bc1cd6ca38c5a51163` after its gates passed.
- `@everydaydevopsio/hail@0.1.1` is public on npm with `latest` pointing to it. The registry tarball passed a published CLI `hail --help` smoke check. [GitHub Release v0.1.1](https://github.com/everydaydevopsio/hail/releases/tag/v0.1.1) exists. Initial publication used npm owner browser authentication and has no CI provenance.
- GitHub `npm` environment is restricted to `main`. The npm owner enabled direct `npm publish` for the trusted publisher.
- Trusted-publisher test run [37942699145](https://github.com/everydaydevopsio/hail/actions/runs/37942699145) passed all prepare gates and created `v0.1.2`, but npm rejected direct publish with `403 OIDC permission denied for this action`. After the owner enabled direct publishing, [retry run 37944187301](https://github.com/everydaydevopsio/hail/actions/runs/37944187301) passed and published the same tag with provenance. npm `latest` is `0.1.2`, a GitHub Release exists, and a fresh consumer install ran `hail --help` successfully.

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
