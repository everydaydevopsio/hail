# CLI reference

Run `hail --help` for the command list, or `hail <command> --help` (also `-h`) for command-specific usage. Help exits without AWS credentials, DNS requests, Terraform, or a configuration file.

## `hail init`

Generates receiver Terraform files after read-only DNS and AWS preflight checks. It does not apply Terraform.

```bash
hail init --dns manual --domain email-test.example.com --zone-name example.com --existing-rule-set shared-inbound
```

| Option                              | Meaning and default                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| `--domain DOMAIN`                   | Required dedicated test subdomain inside the selected zone.                                      |
| `--zone-name ZONE`                  | Required authoritative parent DNS zone.                                                          |
| `--dns cloudflare\|route53\|manual` | DNS mode; default `manual`.                                                                      |
| `--zone-id ID`                      | Required for Cloudflare or Route53; omit for manual DNS.                                         |
| `--region REGION`                   | SES receiving region; default `us-east-1`.                                                       |
| `--name NAME`                       | Resource name; default `hail`.                                                                   |
| `--existing-rule-set NAME`          | Use an active SES receipt rule set. Choose this or `--activate-new-rule-set`.                    |
| `--activate-new-rule-set`           | Select a new receipt rule set only when none is active. Choose this or `--existing-rule-set`.    |
| `--out DIR`                         | Output directory; default `infra/hail`.                                                          |
| `--file NAME.tf`                    | Generated Terraform filename; default `main.tf`.                                                 |
| `--local-modules`                   | Copy the bundled module; otherwise reference the Git tag matching the installed package version. |

`init` never overwrites generated files. It rejects an existing MX record and refuses to replace an active SES rule set. Review generated files and your Terraform plan before applying.

## `hail configure`

Reads the Terraform `hail_config` output and writes an owner-only configuration file without overwriting an existing file.

```bash
hail configure --terraform-dir infra/hail
```

| Option                | Meaning and default                                          |
| --------------------- | ------------------------------------------------------------ |
| `--terraform-dir DIR` | Required Terraform root containing the `hail_config` output. |
| `--out FILE`          | Destination; default `hail.config.json`.                     |

## `hail doctor`

Performs read-only DNS, SES, and S3 access checks. It does not send email or prove delivery.

```bash
hail doctor --config hail.config.json
```

| Option          | Meaning and default                                                               |
| --------------- | --------------------------------------------------------------------------------- |
| `--config FILE` | Configuration path; default `HAIL_CONFIG` when set, otherwise `hail.config.json`. |

Invalid or missing options exit with a named option error. Run the relevant `hail <command> --help` for usage.

## `hail smoke`

Explicitly sends one synthetic message through SES to a fresh random address under the configured Hail domain. It checkpoints the inbox first, then checks the sender, recipient, subject, and unique body marker. It does not create Terraform resources or log in to an application.

```bash
hail smoke --config hail.config.json \
  --from verified-sender@example.com --send-region us-east-1 \
  --account 123456789012 \
  --reader-role-arn arn:aws:iam::123456789012:role/hail-reader \
  --sender-role-arn arn:aws:iam::123456789012:role/hail-sender \
  --reader-session-file /private/reader.json \
  --sender-session-file /private/sender.json \
  --timeout-ms 60000
```

The reader and sender files must be distinct, owned by the current user, mode 0600, and contain short-lived `accessKeyId`, `secretAccessKey`, `sessionToken`, and ISO `expiration` fields. Hail verifies each assumed role and the expected account with STS. The reader needs S3 list/get access to the receiver bucket; the sender needs `ses:SendRawEmail` for the verified identity and destination. The SES client makes one API attempt. The wait is bounded to 5–120 seconds (60 seconds by default), and at most five matching messages are inspected. The result never prints the inbox address, message body, raw MIME, or credentials.

The sender identity must be verified in the sending region. In the SES sandbox, the recipient domain must also be verified there; otherwise request production sending access. On timeout, inspect MX, receipt-rule ordering, pipeline health, and the ingestion DLQ with a separate diagnostics identity. A timeout alone cannot distinguish SMTP receipt failure from ingestion delay. Check that the DLQ remains empty after a successful live smoke run. `doctor` stays read-only; `test:live` exercises browser workflows, while `test:live:full` provisions a disposable receiver.
