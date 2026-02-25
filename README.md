# CodeSentinel

CodeSentinel is a structural and evolutionary risk analysis engine for modern TypeScript/JavaScript codebases. It turns architecture, change history, and dependency health into a unified risk model that helps engineering teams spot fragility before it becomes failure.

This repository contains the initial monorepo scaffolding and CLI foundation. The analysis engines are intentionally lean right now, but the structure is designed to scale cleanly as the system grows.

## Vision

CodeSentinel combines three signals into a single, explainable risk profile:

- **Structural risk**: dependency graph topology, cycles, coupling, fan-in/fan-out, boundary violations.
- **Evolutionary risk**: change frequency, hotspots, bus factor, volatility.
- **External risk**: transitive dependency exposure, maintainer risk, staleness and abandonment indicators.

The goal is a practical, engineering-grade model that supports both strategic architecture decisions and daily code review workflows.

## Monorepo Layout

- `packages/core`: shared domain types and cross-cutting services.
- `packages/code-graph`: source graph analysis primitives.
- `packages/git-analyzer`: Git history and evolutionary signals.
- `packages/dependency-firewall`: external dependency and supply chain signals.
- `packages/risk-engine`: risk aggregation and scoring model.
- `packages/reporter`: structured report output (console, JSON, CI).
- `packages/cli`: user-facing CLI entrypoint.

Each package is standalone, ESM-only, TypeScript-first, and built with `tsup`. The CLI depends on `core`; domain packages are kept decoupled to avoid circular dependencies.

## Requirements

- Node.js 24
- pnpm

## Commands

- `pnpm install`
- `pnpm build`
- `pnpm dev`
- `pnpm test`
- `pnpm release`

## CLI

Install globally with npm:

```bash
npm install -g @codesentinel/codesentinel
```

Then run:

```bash
codesentinel analyze [path]
```

Examples:

```bash
codesentinel analyze
codesentinel analyze .
codesentinel analyze ../project
```

Author identity mode:

```bash
# Default: heuristic merge of likely same person across emails
codesentinel analyze . --author-identity likely_merge

# Deterministic: strict email identity, no heuristic merging
codesentinel analyze . --author-identity strict_email
```

Notes:

- `likely_merge` (default) may merge multiple emails that likely belong to the same person based on repository history.
- `strict_email` treats each canonical email as a distinct author, which avoids false merges but can split the same person across multiple emails.
- Git mailmap is enabled (`git log --use-mailmap`). Put `.mailmap` in the repository being analyzed (the `codesentinel analyze [path]` target). Git will then deterministically unify known aliases before CodeSentinel computes `authorDistribution`.
- `authorDistribution` returns whichever identity mode is selected.

When running through pnpm, pass CLI arguments after `--`:

```bash
pnpm dev -- analyze
pnpm dev -- analyze .
pnpm dev -- analyze ../project
pnpm dev -- analyze . --author-identity strict_email
```

## Release Automation

- Pull requests to `main` run build and tests via `.github/workflows/ci.yml`.
- Merges to `main` run semantic-release via `.github/workflows/release.yml`.
- semantic-release bumps `packages/cli/package.json`, creates a GitHub release, publishes to npm, and pushes the version-bump commit back to `main`.
- Dependabot is configured monthly in `.github/dependabot.yml` for npm and GitHub Actions updates.

Trusted Publisher setup (no `NPM_TOKEN` secret):

- In npm package settings for `@codesentinel/codesentinel`, add a Trusted Publisher.
- Provider: `GitHub Actions`.
- Repository: `getcodesentinel/codesentinel`.
- Workflow filename: `release.yml`.
- Environment name: leave empty unless you explicitly use a GitHub Actions environment in this workflow.

Commit messages on `main` should follow Conventional Commits (example: `feat:`, `fix:`, `chore:`) so semantic-release can calculate versions automatically.

## Contributing

This project aims to be production-grade and minimal. If you add new dependencies or abstractions, justify them clearly and keep the architecture clean.

## ESM Import Policy

- The workspace uses `TypeScript` with `moduleResolution: "NodeNext"` and ESM output.
- For local relative imports, use `.js` specifiers in source files (example: `import { x } from "./x.js"`).
- Do not use `.ts` specifiers for runtime imports in package source files.
- This keeps emitted code and runtime resolution aligned with Node.js ESM behavior.

## License

MIT
