# Validation plan

- [x] Identify PR #1 as open; branch from its head `0ad6d738727136dcd1c2e58fe0a3b217a6977c1b` and record main `a74e9d79123024f276e1cb6d5b38316fe54bc4db`.
- [x] Review implementation, security, setup, workflows, and existing evidence. Maintain an evidence matrix.
- [x] Run credential-free Node 22/24, Python, and Chromium baseline; record Terraform, Firefox, and WebKit blockers.
- [x] Add reproducing tests, fix the deadline and package defects, and rerun affected suites.
- [x] Build and inspect a clean packed consumer outside the repository, including two local browser workflows.
- [x] Confirm authorized account `520473892387`, `us-east-1`, Cloudflare zone and unique subdomain, synthetic sender, isolated SES receiving region, and full receiver teardown.
- [x] Implement external-role and permissions-boundary receiver mode; mock plan passed in CI.
- [ ] Add declarative bootstrap IAM and tests on a new branch from merged main. Review trust, exact actions/resources, unsupported scopes, and cleanup before first AWS write.
- [ ] Validate bootstrap policies with Access Analyzer and simulation; create only run-owned bootstrap IAM with `biokeytic`, then assert restricted identities per phase.
- [ ] Generate and review a saved receiver plan under the provisioner, with the Cloudflare credential fetched by `marka` and isolated from reader/browser processes.
- [ ] Provision only approved disposable resources; run real mail/browser, fault, permission, drift, and teardown checks.
- [ ] Record final commit, package, roles, evidence, blockers, and cleanup state; PR #2 is open with Copilot review, and CI must rerun after credential fixes.

## Decisions and risk

PRs #1 and #2 merged with green CI; the exact main commit before live bootstrap is `164674d231fda81fbf408cdb7e11958cc7f24937`. No live write occurs before the exact bootstrap plan is shown and checked. Terraform state, credentials, plans, message data, and private resource manifests stay outside Git. Rollback is run-owned Terraform destroy followed by scoped bootstrap cleanup after verifying ownership and dependencies. This run's Cloudflare DNS records are limited to `hail-20261005-202402.markcallen.dev` and its SES verification names. SES has no active receipt rule set at discovery; recheck immediately before apply and do not displace another set.
