# Task: Ballast audit and rule compliance

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
