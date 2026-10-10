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
