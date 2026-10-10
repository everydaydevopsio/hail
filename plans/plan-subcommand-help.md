# Subcommand help

Status: Ready for review
Branch: issue-24-subcommand-help  
Created: 2026-10-09  
Related ADRs: none

## Problem

Subcommand `--help` is parsed as an unknown option and reported as a generic TypeError. New users cannot discover required flags or defaults.

## Approach

Handle help before option parsing or external work. Give each command its own usage text. Preserve the existing parser for execution and translate parser errors into flag-specific CLI errors. Align the quickstart and a command reference with the actual defaults.

## Files affected

- `PRD.md`, `tasks/todo.md`, and this plan: acceptance criteria and task evidence.
- `src/cli.ts`, `src/setup.ts`: help routing and named option validation.
- `tests/unit/cli.test.ts`: subprocess regression tests.
- `docs/CLI.md`, `docs/README.md`, `docs/QUICKSTART.md`: command reference and entry points.

## Phases

- [x] Add failing tests.
- [x] Implement help and errors.
- [x] Update docs and run validation.

## Verification

Run CLI tests, typecheck, unit and coverage tests, Python tests, browser tests, and Terraform validate/mock tests. Help subprocesses must succeed with no credentials.

Result: 48 Node and 42 Python tests passed; coverage is 97.44% of lines. All five Terraform roots passed validation and mock tests. Chromium and Firefox passed 18 browser cases; WebKit lacked host libraries and remains a CI gate. Build, typecheck, lint, and formatting passed.

## Alternatives rejected

- A new CLI dependency adds surface area for three commands without improving this fix.

## Open questions

None.

## Change log

| Date       | Change                                                                |
| ---------- | --------------------------------------------------------------------- |
| 2026-10-09 | Initial plan.                                                         |
| 2026-10-10 | Tests, implementation, documentation, and local validation completed. |
