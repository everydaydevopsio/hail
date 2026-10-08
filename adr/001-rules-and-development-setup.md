# 001: Audited rules and reproducible development setup

Status: Accepted
Date: 2026-10-08
Branch: chore/ballast-rules-audit
PR: Linked from the branch pull request
Supersedes: None
Superseded-by: None

## Context
Hail's initial Ballast installation included unrelated publishing/logging/Spec Kit
rules, canonical drift, and tooling preferences inconsistent with npm. Applicable
rules also lacked lint, coverage, hooks, and infrastructure scanning enforcement.
The user requested an audit, a second compliance review, green PR checks and
merge, then added reproducible dependency installation and local shell setup.

## Decision
Keep the 16 evidence-backed rules per target in .rulesrc.json and regenerate with
Ballast 5.21.3. Exclude immutable upstream snapshots from discovery. Preserve npm,
Node tests, Python tests and Playwright. Install tooling with make deps; prepare
hooks, providers and shell activation with make setup; missing tools direct the
developer to make deps. Keep tools and browsers local to the checkout.

## Alternatives Considered
- Retain all rules: adds procedures with no current repository evidence.
- Hand-edit generated rules: creates drift and is lost on refresh.
- Switch package/test frameworks: adds migration without product benefit.
- Modify global shell files: unnecessary; explicit activation is sufficient.

## Consequences
Less per-session context and concrete development gates. Dependency setup needs
network access and may need privilege for OS/browser libraries. Linux is tested;
macOS is supported by code but not locally verified. Existing receiver encryption
design decisions remain explicit file-scoped scanner exceptions.

## Implementation Notes
See docs/RULES-AUDIT.md for configuration, byte costs, clean-generation evidence
and each rule's applicability. docs/DEVELOPMENT.md covers Make targets and hooks.
No upstream, cloud state or release channel changes are part of this decision.

## Verification
make deps, make setup, make check; ownership census and clean-install comparison;
setup failure-path regression tests; commit/push hooks and PR Actions.

## Lessons Learned
Exclude discovery paths, not just saved language paths. Test actual setup in the
current environment: shared browser caches can be unwritable. Preserve explicit
Hail constraints separately from generated Ballast instructions.
