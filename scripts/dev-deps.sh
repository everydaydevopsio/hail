#!/usr/bin/env bash
# Install contributor tools locally; only OS packages/browser libraries need privilege.
set -euo pipefail
cd "$(dirname "$0")/.."
repo_root="$PWD"
tools_dir="$repo_root/.dev-tools"
export PATH="$tools_dir/bin:$tools_dir/venv/bin:$tools_dir/tfenv/bin:$PATH"
export PLAYWRIGHT_BROWSERS_PATH="$tools_dir/browsers"
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=l
platform="$(uname -s)"
architecture="$(uname -m)"
case "$architecture" in
  x86_64) release_arch=amd64; node_arch=x64; trivy_arch=64bit; leaks_arch=x64 ;;
  arm64|aarch64) release_arch=arm64; node_arch=arm64; trivy_arch=ARM64; leaks_arch=arm64 ;;
  *) echo "Unsupported architecture: $architecture" >&2; exit 1 ;;
esac
case "$platform" in
  Linux)
    os=linux; trivy_os=Linux
    missing_system=0
    for tool in curl git unzip python3; do command -v "$tool" >/dev/null || missing_system=1; done
    python3 -c 'import ensurepip, venv; assert __import__("sys").version_info >= (3, 12)' 2>/dev/null || missing_system=1
    if [ "$missing_system" = 1 ]; then
      command -v apt-get >/dev/null || { echo 'Automatic Linux setup requires Ubuntu 24.04+ (apt and Python 3.12+).' >&2; exit 1; }
      privilege=(); if [ "$(id -u)" != 0 ]; then privilege=(sudo); fi
      "${privilege[@]}" apt-get update
      "${privilege[@]}" env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get install -y ca-certificates curl git unzip python3 python3-venv python3-pip
    fi
    ;;
  Darwin)
    os=darwin; trivy_os=macOS
    command -v brew >/dev/null || { echo 'Install Homebrew from https://brew.sh, then rerun make deps.' >&2; exit 1; }
    brew install python@3.12 git unzip
    export PATH="$(brew --prefix python@3.12)/libexec/bin:$PATH"
    ;;
  *) echo 'Supported developer machines: Ubuntu 24.04+ and macOS. Use WSL2 on Windows.' >&2; exit 1 ;;
esac
python3 -c 'import sys; assert sys.version_info >= (3, 12), "Python 3.12+ is required"'
mkdir -p "$tools_dir/bin"
download_dir="$(mktemp -d)"
trap 'rm -rf "$download_dir"' EXIT
verify() {
  python3 - "$1" "$2" <<'PY'
import hashlib
from pathlib import Path
import sys
archive, checksums = map(Path, sys.argv[1:])
expected = next((line.split()[0] for line in checksums.read_text().splitlines() if line.split()[-1].lstrip('*') == archive.name), None)
if expected is None or hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
    raise SystemExit('Checksum verification failed: ' + archive.name)
PY
}
fetch() { curl --fail --silent --show-error --location --retry 3 "$1" --output "$2"; }
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
  fetch https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt "$download_dir/node-sums"
  node_archive="$(python3 - "$download_dir/node-sums" "$os" "$node_arch" <<'PY'
from pathlib import Path
import sys
suffix = '-' + sys.argv[2] + '-' + sys.argv[3] + '.tar.gz'
print(next(line.split()[-1] for line in Path(sys.argv[1]).read_text().splitlines() if line.endswith(suffix)))
PY
)"
  fetch "https://nodejs.org/dist/latest-v22.x/$node_archive" "$download_dir/$node_archive"
  verify "$download_dir/$node_archive" "$download_dir/node-sums"
  mkdir -p "$tools_dir/node"
  tar -xzf "$download_dir/$node_archive" --strip-components=1 -C "$tools_dir/node"
  for tool in node npm npx; do ln -sf "$tools_dir/node/bin/$tool" "$tools_dir/bin/$tool"; done
fi
if [ ! -d "$tools_dir/tfenv" ]; then
  git clone --quiet --depth 1 --branch v3.2.2 https://github.com/tfutils/tfenv.git "$tools_dir/tfenv"
fi
tfenv install "$(cat .terraform-version)"
tfenv use "$(cat .terraform-version)"
fetch https://github.com/terraform-linters/tflint/releases/download/v0.64.0/checksums.txt "$download_dir/tflint-sums"
fetch "https://github.com/terraform-linters/tflint/releases/download/v0.64.0/tflint_${os}_${release_arch}.zip" "$download_dir/tflint_${os}_${release_arch}.zip"
verify "$download_dir/tflint_${os}_${release_arch}.zip" "$download_dir/tflint-sums"
unzip -oq "$download_dir/tflint_${os}_${release_arch}.zip" -d "$tools_dir/bin" tflint
fetch https://github.com/aquasecurity/trivy/releases/download/v0.75.0/trivy_0.75.0_checksums.txt "$download_dir/trivy-sums"
fetch "https://github.com/aquasecurity/trivy/releases/download/v0.75.0/trivy_0.75.0_${trivy_os}-${trivy_arch}.tar.gz" "$download_dir/trivy_0.75.0_${trivy_os}-${trivy_arch}.tar.gz"
verify "$download_dir/trivy_0.75.0_${trivy_os}-${trivy_arch}.tar.gz" "$download_dir/trivy-sums"
tar -xzf "$download_dir/trivy_0.75.0_${trivy_os}-${trivy_arch}.tar.gz" -C "$tools_dir/bin" trivy
fetch https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_checksums.txt "$download_dir/leaks-sums"
fetch "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_${os}_${leaks_arch}.tar.gz" "$download_dir/gitleaks_8.30.1_${os}_${leaks_arch}.tar.gz"
verify "$download_dir/gitleaks_8.30.1_${os}_${leaks_arch}.tar.gz" "$download_dir/leaks-sums"
tar -xzf "$download_dir/gitleaks_8.30.1_${os}_${leaks_arch}.tar.gz" -C "$tools_dir/bin" gitleaks
python3 -m venv "$tools_dir/venv"
"$tools_dir/venv/bin/python" -m pip install 'pre-commit==4.3.0'
npm ci
npm exec -- playwright install --with-deps chromium firefox webkit
printf '%s\n' 'Dependencies installed. Run make setup, then source .dev-tools/activate (or make shell).'
