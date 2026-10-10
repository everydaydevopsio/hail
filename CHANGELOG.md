# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3] - 2026-10-10

### Highlights

- **Opt-in delivery smoke testing:** Added a Hail smoke command to validate delivery, including checks for actual roles and session lifetime. Simplified credentials and invocation, included the verified synthetic email in output, and improved validation error reporting. (#31)
- **npm-first quickstart:** Updated getting-started documentation to prioritize the published npm package. (#27)
- **MIT license:** Hail now uses the MIT license. (#28)

### Fixes

- Made Hail subcommand help more useful. (#30)
- Resolved TypeScript dependency compatibility by using supported TypeScript 6 and Node.js 22 type definitions, with compatibility notes documented. (#17)

### Changes

- **Runtime dependencies:** Updated the AWS SDK dependency group and upgraded `mailparser` from 3.9.31 to 3.9.36.
- **Terraform dependencies:** Updated the AWS provider to 6.67.0 across the receiver module and examples, and the Cloudflare provider to 5.27.0 in the Cloudflare example.
- **CI and tooling:** Updated GitHub Actions for checkout, language setup, Terraform setup, and AWS credentials, along with development tooling dependencies.
- **Release workflow and documentation:** Added Castoff-generated release notes to Hail releases and documented the first npm release and publish recovery process. (#29, #23)
