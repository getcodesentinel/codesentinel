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

## CLI

The CLI currently exposes a single command and prints the resolved analysis target:

```bash
codesentinel analyze [path]
```

Examples:

```bash
codesentinel analyze
codesentinel analyze .
codesentinel analyze ../project
```

When running through pnpm, pass CLI arguments after `--`:

```bash
pnpm dev -- analyze
pnpm dev -- analyze .
pnpm dev -- analyze ../project
```

## Contributing

This project aims to be production-grade and minimal. If you add new dependencies or abstractions, justify them clearly and keep the architecture clean.

## License

MIT
