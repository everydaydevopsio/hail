# Hail validation and hardening

## Scope

Hail must be validated as an installable consumer package and, when a specifically approved test domain and sender are available, as a real SES receiver used by browser workflows. Local, mocked, injected pipeline, and live results are reported separately. No release, merge, or production change is part of this work.

## Acceptance criteria

- VAL-01: The exact stacked base and tested commit are recorded; upstream snapshots remain unchanged.
- VAL-02: Credential-free build, type, unit, Python, browser, Terraform, and packed-consumer tests cover supported runtimes, DNS templates, and browser engines.
- VAL-03: Browser tests prove identity, request binding, replay/expiry/revocation, role boundaries, inbox isolation, and secret-safe reporting.
- VAL-04: Receiver deployment supports externally managed execution and reader roles without creating hidden IAM resources, and module-created roles can use permissions boundaries.
- VAL-05: A separate, declarative IAM bootstrap and isolated phase commands restrict provisioning, reading, sending, diagnostics, and cleanup to approved run resources; policy scope and unavoidable wildcards are documented and verified.
- VAL-06: Approved live DNS/SES infrastructure is planned, applied, checked for drift, and used for real email plus browser workflows through the packed package.
- VAL-07: Controlled pipeline faults, positive and negative permission checks, and disposable teardown are proven with run-owned resources.
- VAL-08: A sanitized evidence matrix records each result as PASS, FAIL, or BLOCKED with exact role and commit. A stacked PR stays open for review.

## Safety constraints

The `biokeytic` source profile is used only for bounded prerequisite discovery and explicitly approved bootstrap IAM writes, assumption, corrections, and cleanup. Ordinary Terraform and tests use restricted roles. An observed resource or domain does not authorize a write. Missing account, zone, DNS, sender, or SES rule-set approval blocks the dependent live step. At most four live workers and 200 synthetic sends, including retries, are permitted per run.
