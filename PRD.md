# Hail validation and hardening

## Scope

Hail must be validated as an installable consumer package and, when a specifically approved test domain and sender are available, as a real SES receiver used by browser workflows. Local, mocked, injected pipeline, and live results are reported separately. PRs #1 and #2 were merged after green CI at the operator's request. No package release or production infrastructure change is part of this work.

## Acceptance criteria

- INIT-01: `hail init` generates a receiver Terraform source pinned to the Git tag `v<installed Hail package version>` by default; an explicit local-module option copies and references the bundled module instead.
- INIT-02: The caller can choose the output directory and Terraform `.tf` filename. Existing directories are usable when generated files do not conflict; initialization never overwrites an existing file.

- VAL-01: The exact stacked base and tested commit are recorded; upstream snapshots remain unchanged.
- VAL-02: Credential-free build, type, unit, Python, browser, Terraform, and packed-consumer tests cover supported runtimes, DNS templates, and browser engines.
- VAL-03: Browser tests prove identity, request binding, replay/expiry/revocation, role boundaries, inbox isolation, and secret-safe reporting.
- VAL-04: Receiver deployment supports externally managed execution and reader roles without creating hidden IAM resources, and module-created roles can use permissions boundaries.
- VAL-05: A separate, declarative IAM bootstrap and isolated phase commands restrict provisioning, reading, sending, diagnostics, and cleanup to approved run resources; policy scope and unavoidable wildcards are documented and verified. Bootstrap roles are independently testable, and no ordinary provision or test phase can reach a bootstrap credential chain.
- VAL-06: Approved live DNS/SES infrastructure is planned, applied, checked for drift, and used for real email plus browser workflows through the packed package.
- VAL-07: Controlled pipeline faults, positive and negative permission checks, and disposable teardown are proven with run-owned resources.
- VAL-08: A sanitized evidence matrix records each result as PASS, FAIL, or BLOCKED with exact role and commit. Follow-up bootstrap and live-validation changes receive a separate reviewable PR based on merged main.

## Safety constraints

The `biokeytic` source profile is used only for bounded prerequisite discovery and explicitly approved bootstrap IAM writes, assumption, corrections, and cleanup. Ordinary Terraform and tests use restricted roles. An observed resource or domain does not authorize a write. Missing account, zone, DNS, sender, or SES rule-set approval blocks the dependent live step. At most four live workers and 200 synthetic sends, including retries, are permitted per run.

The approved disposable run uses account `520473892387`, `us-east-1`, Cloudflare zone `markcallen.dev` (`dec4b7aba90019a2a2f2aee0bca64116`), receiver domain `hail-20261005-202402.markcallen.dev`, and sender `sender@hail-20261005-202402.markcallen.dev` in `us-east-1`. The account is approved as isolated for SES receiving, and the receiver must be destroyed after validation. The Cloudflare credential is fetched from `/hail/local` in the separate `marka` profile account and is never passed to reader or browser phases.
