# Task: show verified synthetic email in smoke output

## Context and plan

- Date: 2026-10-10. Mode: autonomous local output improvement. PRD: SMOKE-02.
- Generate one short harmless text phrase plus the unique marker; display From, To, Subject, and Text only after the received mail passes exact matching. Failure output remains fixed and redacted.
- Verify success details come from the confirmed received message, and mismatched mail never appears in output. Run local build, typecheck, unit, lint, formatting, package, and coverage checks. Rollback: revert this commit; no cloud operation.

## Checklist

- [x] Update output, docs, and tests.
- [x] Run local checks and record results.
- [x] Commit the change.

## Outcome

- Success now prints the exact synthetic From, recipient, subject, and short generated text from the matched received email. The generator chooses one of three harmless phrases and adds a unique reference marker. Wrong sender/body messages remain excluded; failure output remains redacted.
- Build, typecheck, lint, Prettier, package audit, 51 Node tests, 42 Python tests, and coverage passed (92.83% lines). Browser and Terraform behavior is unchanged; prior branch checks apply. No new real email was sent.

# Previous task: simplify issue #26 smoke invocation

## Context and plan

- Date: 2026-10-10. Mode: autonomous correction to the requested CLI; no cloud operation. PRD: SMOKE-01/02.
- Replace mandatory role/account/session flags with the receiver config and normal AWS credential chain. Add optional `--profile`; derive SES region from receiver config. Preserve one send, bounded read, unique address, and safe output.
- Tests: CLI help and missing sender; credential selection and reader role behavior with injected clients/providers; existing smoke matching and timeout tests. Run build, quality, unit/Python/browser/package/Terraform gates as required.
- Risk: selected credentials must have `ses:SendRawEmail` and S3 read or `sts:AssumeRole` for configured reader role. Rollback: revert correction commit; no cloud state changed.

## Checklist

- [x] Update CLI, credential wiring, docs, and tests.
- [x] Run local validation and record results.
- [x] Commit correction.

## Outcome

- `hail smoke --from ADDRESS` now uses `hail.config.json`, its region and optional reader role, and the normal AWS credential chain. `--profile` selects a named source profile. The seven mandatory account/role/session flags and separate send-region flag are removed.
- Build, typecheck, lint, Prettier, 51 Node tests, 42 Python tests, package audit, and coverage passed (92.74% lines). Earlier Chromium/Firefox and Terraform checks remain applicable because the correction changes only the smoke CLI and credential selection. WebKit still needs host libraries; no live send or DLQ check was run.

# Previous task: issue #26 delivery smoke

## Context and plan

- Date: 2026-10-10. Mode: implementation authorized by user; live send requires separate explicit authorization. PRD: SMOKE-01/02.
- Add a bounded CLI command using distinct restricted reader/sender sessions and one synthetic SES send. Keep the browser suites, doctor, and Terraform behavior unchanged.
- Risk: SES and S3 permissions or routing may fail independently. Report only supported diagnoses. Rollback: revert the branch commit; no cloud state changes from implementation.

## Checklist

- [x] Write failing local tests for uniqueness, exact matching, timeout, and safe output.
- [x] Implement CLI and documentation.
- [x] Run build, typecheck, unit, Python, browser, Terraform validate/mock, coverage, then Bosun review.
- [x] Record test outcomes and live verification gap.

## Outcome

- `hail smoke` uses separate STS-verified reader/sender sessions, one random inbox, one `SendRawEmail` API attempt, and a bounded wait for exact sender, subject, recipient, and body marker. Local tests cover uniqueness, mismatches, timeout, and safe error output.
- Build, typecheck, lint, Prettier, 50 Node tests, 42 Python tests, package audit, and all five Terraform validate/mock roots passed. Coverage: 88.07% lines, 86.94% branches, 94.03% functions. Chromium and Firefox passed 9/9 each outside the sandbox; full WebKit requires missing host libraries. Terraform still reports the preexisting provider deprecation tracked in #25.
- A real send/read and empty-DLQ check were not run because this task did not explicitly authorize sending real email. Live evidence remains required before claiming cloud delivery. Rollback is a revert of this branch commit; implementation changed no cloud state.
- Bosun review of `149a1a1` against the default-branch fork point found two valid medium issues: caller-supplied ARN account was not checked against STS, and credential lifetime was checked too early. A follow-up commit validates the actual STS role IDs/account and rechecks lifetime immediately before sending; focused tests cover both failures.
- After the Bosun fixes, build, typecheck, lint, Prettier, package audit, 52 Node tests, and coverage passed (88.05% lines, 86.59% branches, 94.29% functions). Browser, Python, and Terraform results above remain valid because the follow-up changes only the smoke credential checks and their local tests.

# Previous task: issue #24 subcommand help

## Context

- Date: 2026-10-09
- Mode: Autonomous localized CLI bug fix; no cloud or infrastructure changes.
- PRD: CLI-01.

## Scope and constraints

- Add pre-validation help for init, configure, and doctor; improve option errors and align CLI docs.
- Preserve read-only help and existing command defaults; do not call AWS, DNS, or Terraform for help.

## Execution checklist

- [x] Add regression tests and confirm the help and error paths fail on the existing CLI.
- [x] Implement command help and named option errors; update CLI reference and quickstart.
- [x] Run quality, unit, Python, browser, and Terraform mock gates and record results.

## Test and rollback strategy

- Test every help command, aliases, and missing/invalid flags in subprocesses with no credentials.
- Revert this branch to restore prior CLI behavior; no cloud state is changed.

## Outcome

- Before: `hail init --help` exited 1 with a generic TypeError message. After: init, configure, and doctor `--help` and `-h` exit 0 with usage, defaults, alternatives, and examples; bad values identify their flags.
- `npm run build`, `npm run typecheck`, `npm run lint`, `npm run prettier`, `npm test` (48 passed), `npm run test:python` (42 passed), and `npm run test:coverage` passed (97.44% lines, 87.92% branches, 96.77% functions).
- All five Terraform roots passed validate and mock tests. `npm run test:e2e` passed 18 Chromium/Firefox cases; nine WebKit cases could not launch because this host lacks GTK/GStreamer and related libraries. CI installs the browser dependencies.
- No live AWS, DNS, email, or Terraform apply operation was run. Rollback is a branch revert.

# Previous task: compatible TypeScript dependency update

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
