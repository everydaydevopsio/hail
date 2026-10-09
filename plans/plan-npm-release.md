# npm release workflow plan

Status: Implemented, pending CI and operator setup  
Branch: `feature/dispatch-npm-release`  
Created: 2026-10-09  
Related ADRs: none

## Problem

Hail has a package and validation CI, but no release channel. Its CI also assumes the first tarball version forever.

## Approach

Adapt Pilot's manual semver release, npm provenance, and GitHub Release flow. Use Hail's npm lockfile and gates. Restrict dispatch to `main`, publish from a matching workflow-created tag, and allow a tagged retry after a registry failure. The first package version is published by an authenticated npm owner from a workflow-created tag because npm requires an existing package before trusted publishing can be configured. Later releases keep registry credentials confined to the publishing job via trusted publishing.

## Files affected

- `PRD.md`: release acceptance criteria.
- `.github/workflows/release.yml`: release validation, tagging, publication.
- `.github/workflows/ci.yml`: version-independent packed consumer checks.
- `README.md`, `docs/README.md`, `docs/RELEASING.md`: operator instructions.
- `tasks/todo.md`: branch execution evidence.

## Phases

- [x] Review Pilot workflow, Hail constraints, and PRD.
- [x] Implement release workflow and dynamic CI tarball checks.
- [x] Document setup, dispatch, retry, and limits.
- [x] Run static workflow checks and Hail local validation; WebKit is blocked by missing host libraries.

## Verification

Run actionlint, typecheck, Node/Python/browser tests, and Terraform validate/mock tests. A real npm publish requires explicit operator dispatch and cannot be locally simulated.

## Alternatives rejected

- Tag-push automatic publishing: a workflow-created tag pushed with `GITHUB_TOKEN` does not trigger another workflow, and arbitrary pushed tags expand the publish entrypoint.
- npm token secret: trusted publishing provides short-lived credentials bound to the repository workflow.

## Open questions

None for the workflow. npm trusted publisher and GitHub `npm` environment must be configured before dispatch.

## Change log

| Date | Change |
| --- | --- |
| 2026-10-09 | Plan created from Pilot's publish workflow and Hail's release rules. |
| 2026-10-09 | Added npm repository metadata for trusted publishing and completed local checks. |
| 2026-10-09 | Added a first-publication dispatch after confirming npm trust requires an existing package. |
