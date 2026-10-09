# Castoff release notes

Status: Implemented; awaiting PR review  
Branch: `chore/castoff-release-notes`  
Created: 2026-10-09  
Related ADRs: None

## Problem

Hail's manual release workflow creates GitHub generated notes and keeps no versioned changelog. REL-07 requires Castoff notes and a changelog entry in the tagged source.

## Approach

For a new release, check the OpenAI key before versioning, then run Castoff and its changelog writer after selecting the new version but before the release commit and atomic push. Pass the generated notes to the publish job. A retry checks out the existing tag, skips Castoff and the changelog writer, and uses GitHub generated notes if it must create a Release.

## Files Affected

- `PRD.md`: define the release requirement.
- `.github/workflows/release.yml`: generate and publish notes, commit changelog.
- `docs/RELEASING.md`: explain key setup, order, and recovery.
- `tasks/todo.md`: track evidence and completion.
- `plans/README.md`: index this plan.

## Phases

- [x] Inspect Hail release and Pilot/Castoff patterns; define REL-07.
- [x] Update release workflow.
- [x] Update operator docs.
- [x] Run static and local gates; record limits.

## Verification

Run `actionlint`, Prettier, npm build/typecheck/test/Python/browser/package checks, and Terraform validate/mock tests. A manual dispatch with the configured secret is required for live Castoff API proof; no dispatch is authorized by this change.

Local evidence: `actionlint`, Prettier, build, typecheck, lint, 46 Node tests, 42 Python tests, package audit, and all five Terraform validate/mock roots passed. Node coverage was 97.43% lines. Chromium and Firefox E2E passed 18 tests; the full browser run was attempted, but WebKit system libraries are missing on this host.

## Alternatives Rejected

- Generate notes after tagging: the changelog would not be part of the tagged source.
- Regenerate notes on a retry: the same tag could receive different AI text and would require the key again for recovery.

## Open Questions

- Whether `OPENAI_API_KEY` is granted to Hail cannot be read with current GitHub permissions; the operator must configure or verify it before dispatch.

## Change Log

| Date | Change |
| --- | --- |
| 2026-10-09 | Initial plan and REL-07. |
| 2026-10-09 | Implemented Castoff and retry flow; recorded local validation. |
