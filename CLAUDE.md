# CLAUDE.md

This file provides guidance to Claude Code for working in this repository.

Read `AGENTS.md` for Hail-specific security boundaries and rule applicability before changing code.

## Repository Facts

Use this section for durable repo-specific facts that agents repeatedly need. Prefer facts stored here over re-deriving them with shell commands on every task.

Keep only stable, reviewable metadata here. Do not store secrets, credentials, or ephemeral runtime state.

Suggested facts to record:

- Canonical GitHub repo: `everydaydevopsio/hail`
- Default branch: `main`
- Primary package manager: `npm`
- Version-file locations agents should check first: `.nvmrc, package.json`
- Canonical config files: `tsconfig.json`
- Primary CI workflows: `ci.yml`
- Primary release/publish workflows: `<workflow filenames>`
- Preferred build/test/lint/format/coverage commands: `package.json:test, package.json:build, package.json:format`
- Coverage threshold: `<value>`
- Generated or protected paths agents should avoid editing directly: `.ballast/`

Update this section when those facts change. If live runtime state is required, discover it separately instead of treating it as a durable repo fact.

## Installed agent rules

Created by Ballast. Do not edit this section.

### Repository Tool Policy

- Check `.rulesrc.json` `tools` before adding, installing, or running language tooling.
- Configured tools: terraform=tfenv,tflint,trivy; typescript=npm.

Read and follow these rule files in `.claude/rules/` when they apply:

- `.claude/rules/common/local-dev-autonomy.md` — Rules for common/local-dev-autonomy
- `.claude/rules/common/local-dev-badges.md` — Rules for common/local-dev-badges
- `.claude/rules/common/local-dev-env.md` — Rules for common/local-dev-env
- `.claude/rules/common/local-dev-license.md` — Rules for common/local-dev-license
- `.claude/rules/common/docs.md` — Rules for common/docs
- `.claude/rules/common/cicd.md` — Rules for common/cicd
- `.claude/rules/common/git-hooks.md` — Rules for common/git-hooks
- `.claude/rules/common/tasks-task-system.md` — Rules for common/tasks-task-system
- `.claude/rules/common/tasks-todo.md` — Rules for common/tasks-todo
- `.claude/rules/common/plan-lifecycle.md` — Rules for common/plan-lifecycle
- `.claude/rules/common/testing-process.md` — Rules for common/testing-process
- `.claude/rules/common/core.md` — Rules for common/core
- `.claude/rules/typescript/typescript-linting.md` — Rules for typescript/linting
- `.claude/rules/typescript/typescript-testing.md` — Rules for typescript/testing
- `.claude/rules/terraform/terraform-linting.md` — Rules for terraform/linting
- `.claude/rules/terraform/terraform-testing.md` — Rules for terraform/testing

## Installed skills

Created by Ballast. Do not edit this section.

These skills are registered with Claude Code. Invoke one by name (for example `/ballast-audit`) when it is relevant:

- `/ballast-audit` — audit a Ballast installation for stale, unowned, oversized, and irrelevant rules and skills, and report the narrowest config that still covers the repository
