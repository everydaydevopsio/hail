# Single-command Cloudflare validation: 2026-10-08

The new [full live runner](LIVE-RUNNER.md) completed in one invocation with exit status 0, `result: PASS`, and `cleanup: PASS`. The run began on October 7 UTC and finished on October 8. This is separate evidence from the [earlier manually orchestrated run](LIVE-EVIDENCE-20261007.md).

## Exact revision and invocation

- Tested committed source: `cce540a628a29c8f71d32aa3131d359680447ca4`. Subsequent documentation commits do not represent another live run.
- Run: `hail-20261007-492d211bad`; fresh receiver `hail-20261007-492d211bad.markcallen.dev`; AWS account `520473892387`, region `us-east-1`, existing Cloudflare zone `markcallen.dev`.
- Packed artifact SHA-256: `d3ede4816db04338468a9cb77c87170efd09bea6dce2d66ac721427929abb778`.
- Linux, Node 24.21.0, Python 3.12.3, Terraform 1.9.8, pinned Playwright 1.63.0 and checked-in provider lockfiles. All browser runs were headless.

This evidence covers the earlier runner interface at the exact revision above. The current [profile/domain command-line interface](LIVE-RUNNER.md) was added later; this historical result does not claim a fresh live run of that interface.

The run used the approved account, zone, source principal/profile, and owner. `CLOUDFLARE_API_KEY` supplied the bearer token without appearing in command arguments. Bootstrap credential-helper environment was available only to bootstrap operations. Dependency installation and application tests used the minimal Bubblewrap filesystem/environment allowlist, without the host home or source profile. Restricted reader/sender identities were independently checked. The parent process retained bootstrap access.

## Results

| Scope | Result |
| --- | --- |
| Credential-free application suite | Build, typecheck, 43 unit tests, 25 Python tests, 27 browser cases across Chromium/Firefox/WebKit, and package audit of 28 files passed. |
| Terraform | Recursive formatting, validation of all five roots, and 22 mock tests passed: bootstrap 7, receiver 9, Cloudflare 2, Route53 2, manual 2. |
| Bootstrap and receiver | All four policies had zero Access Analyzer findings. Ownership-checked plans created 13 bootstrap and 22 receiver resources. All four direct-reader doctor checks passed; doctor is not delivery evidence. |
| Source live workflows | 27/27 passed across Chromium, Firefox, and WebKit, using real SES mail. |
| Packed consumer | 6/6 live magic-link/invitation cases passed across all three browsers through public package exports. |
| MIME delivery | Real multipart mail reached the visible and envelope-only Bcc inboxes. Generated OTP, exact binary attachment bytes, and trusted receipt timestamps passed despite an old Date header. |
| Actual API denials | Reader write, queue consumption, outside-prefix read, and IAM mutation; sender inbox list, raw read, and IAM mutation; provisioner IAM mutation; and four actual Lambda indexer denials all returned the required authorization-denial result. Missing-resource and malformed-request responses were not accepted. |
| IAM audit | 28 expected simulation decisions passed, recorded separately from actual API denials. |
| Queue recovery | A valid notification indexed alongside poison; poison retried to DLQ; corrected manual replay indexed; duplicate replay preserved identical metadata. Original queue attributes were restored. |
| Indexer restoration | Four denial probes ran under its actual Lambda role. The original worker archive was restored and its hash matched. Post-test Terraform plan reported no drift. |
| Budget and final result | 40 shared send attempts out of 200; one worker and zero retries for each live browser suite. All 94 recorded command phases passed. |

The 15 new Python regression tests cover explicit opt-in, configuration/token validation, clean credential environments, STS log exclusion, ownership/plan gates including computed policy references, private directories, bounded DNS readiness, and failure/cleanup reporting.

## Cleanup and development attempts

The same command stopped run-owned receiving/indexing, purged 170 object entries counted by the guarded cleanup script, and destroyed all receiver and bootstrap resources. Both states contain zero managed resources. Separate checks confirmed bucket 404, no active SES rule set, no records at the two exact generated DNS names, and `NoSuchEntity` for all four IAM roles and policies. Private session/token copies were removed; no runner session directories remained. Private state, plans, and detailed logs were retained for audit and are not normal report attachments.

Earlier command-development attempts are not counted as passing runs. One stopped before provisioning because bootstrap credential-helper environment had been stripped; another stopped at plan review because new attachment ARNs were computed. Both were corrected with regression coverage and required no resource cleanup. A third deployed successfully but encountered a negatively cached MX lookup before sending mail; its automatic teardown passed and both states were empty. The runner now waits up to ten minutes only for DNS readiness, while other doctor failures stop immediately. The final invocation above passed without a doctor retry.

## Limits

Cloudflare was the selected live provider. Route53/manual provisioning remain mock-tested only. Queue evidence covers synthetic injection and corrected manual replay, not native `StartMessageMoveTask` or proof of a shared Lambda batch. IAM simulations do not prove every real mutation denial. These are Hail demo workflows, not another application's authorization or consumer inbox placement. No authentication URL was fetched for extraction; no raw mail, codes, cookies, authentication URLs, or credentials are attached.

No package was published, no human reviewer was requested, and no PR was merged.
