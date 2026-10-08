# Local development

Hail supports Node 22+ (CI tests 22 and 24), Python 3.12+, and Terraform 1.9.8.
Use `nvm use` if you already manage Node with nvm. Keep npm and the checked-in
`package-lock.json`; do not introduce a second package-manager lockfile.

## First setup

```bash
make deps
make setup
source .dev-tools/activate
# Or open a new Bash development shell:
make shell
```

`make deps` supports Ubuntu 24.04+ and macOS (with Homebrew already installed).
Windows contributors can use Ubuntu under WSL2. Make and Bash are bootstrap
prerequisites; macOS also needs its command-line developer tools. On Ubuntu,
install Make first with `sudo apt-get install make` if necessary.

The installer checks OS prerequisites, installs a compatible Node 22 when Node
22+ is absent, and installs tfenv with the version from `.terraform-version`,
TFLint, Trivy, Gitleaks, and pre-commit. Tool releases are pinned in
`scripts/dev-deps.sh`; downloaded binary archives are checked against upstream
SHA-256 lists. It installs npm dependencies from the lockfile and all three
Playwright browsers plus their OS libraries. Linux OS/browser packages can
request sudo. Tools live under ignored `.dev-tools/`; no global shell startup
file is changed. Existing compatible Node installations are reused. Network
access to the official registries and release hosts is required.

`make setup` checks tools before making changes. Missing or incompatible tools
cause it to stop with **Run make deps, then make setup**. It installs locked npm
dependencies, builds, initializes the TFLint plugin, initializes all five
Terraform roots without a backend, installs commit/push hooks, and creates the
shell activation file. Source it in Bash or Zsh, or use `make shell`. A Make
process cannot activate its parent shell. Provider initialization never creates
cloud resources or obtains live credentials.

Neither command installs or configures AWS/DNS credentials, invokes live tests,
or sends mail. For the separate opt-in live runner and its additional operational
prerequisites, see [LIVE-RUNNER.md](LIVE-RUNNER.md).

## Checks

```bash
make check
```

This runs build, lint, format, typecheck, unit tests, coverage, Python tests,
browser tests, package checks, Terraform formatting, TFLint, Trivy, and
backend-free validation/mock tests for all five Terraform roots. These are local
and credential-free checks, not evidence of cloud delivery.

Individual commands remain available:

```bash
npm run lint
npm run prettier
npm run test:coverage
npm run test:smoke
pre-commit run --all-files
pre-commit run --all-files --hook-stage pre-push
```

The existing Node test runner enforces 50% minimum line, function, and branch
coverage of loaded `src/` modules; CLI subprocesses and the Playwright adapter
are additionally exercised by CLI smoke and browser tests. Playwright retains Chromium, Firefox, and WebKit. ESLint
permits empty object parameters only in Playwright spec files because fixtures
require destructured arguments. Terraform lint covers maintained `terraform/`,
not immutable `upstream/`. Trivy fails on HIGH/CRITICAL findings; two documented,
file-scoped encryption design exceptions are in `.trivyignore.yaml`. Lower
severity findings still require review when changing the relevant infrastructure.

Commit hooks run lint, code/YAML formatting, Terraform formatting, and Gitleaks.
The push hook builds, typechecks, runs unit tests, and checks the CLI/package.
The CI developer-setup job exercises the installer and setup on a fresh Linux
runner and checks hooks and infrastructure scans. Keep hooks current with
`pre-commit autoupdate` and review the resulting version changes.

## Tool failures

Run `make deps` for missing tools, missing browsers, or incompatible versions,
then `make setup` again. If a download or registry access fails, fix connectivity
and rerun the same command; it exits nonzero rather than claiming success.
macOS setup is supported by the script but is not covered by the Linux CI job.

Ballast is needed only to regenerate agent guidance, not to build or test Hail.
Use Ballast 5.21.3 and `ballast install --refresh-config --yes --force` after
reviewing `.rulesrc.json`; see [the audit](RULES-AUDIT.md).
