# Plan: versioned initializer module source

Status: Implemented locally; full browser gate blocked by host libraries

Branch: feat/init-versioned-module-source

Created: 2026-10-08
Related ADRs: none

## Problem

The initializer always copies a local module, and its Terraform filename is fixed. Consumers should get a module pinned to their installed Hail version and control where generated Terraform is written.

## Approach

Read the installed package version, generate a Git module source at the corresponding `v` tag, and retain the bundled copy behind `--local-modules`. Keep `--out` as the directory and add `--file` as a safe `.tf` basename. Permit existing directories while refusing file conflicts.

## Files Affected

- `PRD.md`: acceptance criteria.
- `src/setup.ts`, `src/cli.ts`: generation and options.
- `tests/unit/setup.test.ts`: default, local, directory, and conflict checks.
- `README.md`, `docs/QUICKSTART.md`: operator workflow.

## Phases

- [x] Inspect current scaffold and define acceptance criteria.
- [x] Add failing tests and implement source and path options.
- [x] Run available local validation and record host limitation.

## Verification

Typecheck, lint, 46 Node tests, 42 Python tests, Chromium E2E (9 tests), package audit, and Terraform validation/mock tests in all five roots passed. Coverage passed with 97.43% lines, 87.92% branches, and 96.77% functions. Full browser testing requires missing host libraries; `make deps` was retried but another `apt-get` process held the package lock. No cloud deployment is part of this change.

## Alternatives Rejected

- Derive a tag from the local Git checkout: installed consumers may have no `.git` directory.
- Copy the module by default: the user requested a matching Git tag by default.

## Open Questions

None. A matching tag is required for the default source to resolve; unreleased source builds use `--local-modules`.

## Change Log

| Date | Change |
| --- | --- |
| 2026-10-08 | Initial plan and implementation. |
