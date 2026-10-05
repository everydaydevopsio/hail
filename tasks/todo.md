# Validation plan

- [x] Identify PR #1 as open; branch from its head `0ad6d738727136dcd1c2e58fe0a3b217a6977c1b` and record main `a74e9d79123024f276e1cb6d5b38316fe54bc4db`.
- [x] Review implementation, security, setup, workflows, and existing evidence. Maintain an evidence matrix.
- [x] Run credential-free Node 22/24, Python, and Chromium baseline; record Terraform, Firefox, and WebKit blockers.
- [x] Add reproducing tests, fix the deadline and package defects, and rerun affected suites.
- [x] Build and inspect a clean packed consumer outside the repository, including two local browser workflows.
- [ ] Confirm authorized AWS account, region, zone, subdomain, DNS mode, sender, SES rule-set policy, and retention.
- [ ] Implement and review restricted bootstrap IAM, external-role module mode, role isolation, and cleanup.
- [ ] Provision only approved disposable resources; run real mail/browser, fault, permission, drift, and teardown checks.
- [ ] Record exact commit, package, roles, evidence, blockers, and cleanup state; push a stacked PR and review CI.

## Decisions and risk

PR #1 remains open, so the target branch is `feat/hail-playwright-validation`. No live write occurs before the authorization scope is confirmed. Terraform state, credentials, plans, message data, and private resource manifests stay outside Git. Rollback is run-owned Terraform destroy followed by scoped bootstrap cleanup after verifying ownership and dependencies.
