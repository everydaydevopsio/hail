# One-command Cloudflare live test

From a committed source checkout, run:

```bash
npm run test:live:full -- --config /absolute/path/hail-live.json --execute
```

This is an opt-in, real AWS/DNS test: it creates a fresh receiver and four restricted roles, activates its SES receipt rule set only if none is active, sends at most 200 synthetic messages, injects bounded queue faults, and tears down the run-owned resources. It does not publish a package, alter another application's authentication, request PR review, or merge a PR. Ordinary PR CI never invokes it.

## Configure once

Copy [the nonsecret example](../examples/live-cloudflare.json) outside the checkout and fill in the approved AWS account, receiving region, existing Cloudflare zone name/ID, source profile, exact source IAM principal ARN, and owner. For SSO, use the IAM role ARN including its real path, not an edited STS session ARN. The runner verifies the current identity and resolves the role with IAM.

Supply a zone-scoped bearer token in `CLOUDFLARE_API_TOKEN`. `CLOUDFLARE_API_KEY` is accepted as an alias for a bearer token, matching the previous live run; it does **not** mean Cloudflare's email/global-API-key authentication. Conflicting values are rejected. Never put credentials in the JSON file or Git.

Linux prerequisites are Node.js 22+, Python 3.12+, AWS CLI v2, Terraform 1.9.8, Git, Bubblewrap, and Playwright's Linux browser libraries. Node/npm/AWS CLI must be installed beneath `/usr` or `/usr/local`; Terraform must be on `PATH`. The minimal filesystem sandbox deliberately does not expose home-directory toolchains or credential helpers. Set up OS browser dependencies once using the repository's pinned Playwright version (`npx playwright install-deps chromium firefox webkit`) before running the full command. The command downloads all three browsers and installs its own snapshot's npm dependencies without AWS or Cloudflare credentials.

The bootstrap profile must already be authenticated through the standard AWS configuration. Bootstrap processes preserve environment required by `credential_process` helpers; that environment is never passed into the isolated dependency or test phases. Its use is restricted to IAM bootstrap, policy validation/simulation, obtaining short-lived role sessions, and bootstrap teardown. Receiver operations and live tests run with restricted sessions. The source account must permit SES receiving in the chosen region and scoped SES sending; sandbox sender/recipient verification is satisfied by the generated domain when both use that region. The runner stops on provider failures; it never silently widens IAM policies.

Without `--execute`, the command validates only the configuration and makes no cloud calls. `--execute` is the explicit authorization for this configuration and the generated fresh subdomain/sender. The region must have no active receipt rule set; existing shared sets are intentionally unsupported by this disposable full-run command.

## What runs

1. Snapshot the exact committed revision into a private directory. Refuse tracked working-tree changes. Run all dependency installation and local validation inside a filesystem allowlist without the host home or source credentials: build, types, unit/Python/browser/package suites, Terraform formatting, and validation/mock tests for all five roots. Prepare a clean packed consumer including the pinned STS test dependency.
2. Check the approved Cloudflare zone and absence of records at the generated domain. Plan four bounded IAM roles, validate their policies with Access Analyzer, check the plan's ownership/action gates, and apply. Refresh sessions immediately before each live phase.
3. Run `hail init` under the restricted provisioner, preserve the pinned provider lockfile, review the receiver plan's machine-checked ownership constraints, provision, and run direct-reader `doctor` checks.
4. Run 27 source browser cases and six packed-consumer cases across Chromium, Firefox, and WebKit, followed by real MIME/OTP/Bcc/attachment/receipt-timestamp assertions. The shared send budget survives phase restarts, SDK sender retries are disabled, and browser workers/retries remain one/zero.
5. Run the listed restricted-role API denials and separate IAM simulations; test valid/poison queue processing, retry to DLQ, corrected manual replay, and duplicate idempotency. Temporarily instrument only the run-owned indexer to check its actual execution-role denials, restore the original archive, and require a no-drift plan.
6. In a `finally` path, verify ownership, stop run-owned receiving/indexing, purge only the manifest-owned bucket, review and apply destroy plans, verify absence, and delete session/token copies. Test failure never becomes an overall pass because cleanup succeeded.

These are the same scoped scenarios as [the prior live evidence](LIVE-EVIDENCE-20261007.md), with a reader outside-prefix denial added. Route53/manual provisioning, native SQS `StartMessageMoveTask`, and proof that two synthetic records shared one Lambda batch are not claimed. IAM simulations are recorded separately from real API denials. This tests Hail's demo workflows, not another application's selectors, authorization, or consumer inbox placement.

## Results and recovery

The command prints its private run directory and fixed phase labels. `summary.json` contains sanitized phase outcomes, the exact commit and package hash, send count, explicit limits, and cleanup status. Exit status is zero only if every required phase and cleanup passed. Detailed subprocess output stays in mode-0600 logs inside the mode-0700 directory; treat those logs, Terraform state, and any test artifacts as private and do not upload them as ordinary CI reports. The report does not include raw mail, authentication URLs, codes, cookies, or credentials. STS response bodies are never written to command logs.

Use `--output-dir /private/new-directory` to choose an artifact location; it must not already exist. The source checkout is not modified. A lock prevents simultaneous use of the same run directory.

On failure or Ctrl-C, cleanup is attempted. If credentials expire, provider APIs fail, or a different SES rule set becomes active, the command fails closed, retains the states and manifest, and prints a recovery instruction. It never destroys bootstrap roles while receiver cleanup remains incomplete. After resolving access, use the same nonsecret configuration and a fresh Cloudflare environment token:

```bash
npm run test:live:full -- --config /absolute/path/hail-live.json --cleanup /private/retained-run --execute
```

Do not delete the private run directory until cleanup is confirmed. SIGKILL, host failure, and external infrastructure changes can prevent automatic cleanup; retained state is the recovery mechanism. The parent command still has bootstrap access; isolation of child processes does not constrain the parent itself.
