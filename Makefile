SHELL := /bin/bash
DEV_PYTHON = $(if $(wildcard .dev-tools/venv/bin/python),.dev-tools/venv/bin/python,python3)
.DEFAULT_GOAL := help

.PHONY: help deps setup shell check
help:
	@printf '%s\n' 'make deps   Install local development tools, packages and browsers' 'make setup  Prepare hooks, Terraform providers and shell activation' 'make shell  Open a Bash development shell after setup' 'make check  Run credential-free validation'

deps:
	@bash scripts/dev-deps.sh

setup:
	@command -v $(DEV_PYTHON) >/dev/null || { echo 'Python is missing. Run make deps.' >&2; exit 1; }
	@$(DEV_PYTHON) scripts/dev.py setup

shell:
	@test -f .dev-tools/activate || { echo 'Run make setup first (make deps if tools are missing).' >&2; exit 1; }
	@bash --rcfile .dev-tools/activate -i

check:
	@command -v $(DEV_PYTHON) >/dev/null || { echo 'Python is missing. Run make deps.' >&2; exit 1; }
	@$(DEV_PYTHON) scripts/dev.py check
