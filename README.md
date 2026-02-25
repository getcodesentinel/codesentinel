# CodeSentinel

CodeSentinel is a structural and evolutionary risk analysis engine for modern TypeScript/JavaScript codebases. It turns architecture, change history, and dependency health into a unified risk model that helps engineering teams spot fragility before it becomes failure.

This repository contains the initial monorepo scaffolding and CLI foundation. The analysis engines are intentionally lean right now, but the structure is designed to scale cleanly as the system grows.

## Vision

CodeSentinel combines three signals into a single, explainable risk profile:

- **Structural risk**: dependency graph topology, cycles, coupling, fan-in/fan-out, boundary violations.
- **Evolutionary risk**: change frequency, hotspots, bus factor, volatility.
- **External risk**: transitive dependency exposure, maintainer risk, staleness and abandonment indicators.

The CLI output now includes a deterministic `risk` block composed from those dimensions:

- `repositoryScore` and `normalizedScore`
- ranked `hotspots`
- `fragileClusters` (structural cycles + change coupling components)
- `dependencyAmplificationZones`
- file/module/dependency score tables

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

# Quiet mode (only JSON output)
codesentinel analyze . --log-level silent

# Verbose diagnostics to stderr
codesentinel analyze . --log-level debug

# Default compact output (summary)
codesentinel analyze .

# Full output (all sections and detailed arrays)
codesentinel analyze . --output json
codesentinel analyze . --json
```

Notes:

- `likely_merge` (default) may merge multiple emails that likely belong to the same person based on repository history.
- `strict_email` treats each canonical email as a distinct author, which avoids false merges but can split the same person across multiple emails.
- Git mailmap is enabled (`git log --use-mailmap`). Put `.mailmap` in the repository being analyzed (the `codesentinel analyze [path]` target). Git will then deterministically unify known aliases before CodeSentinel computes `authorDistribution`.
- `authorDistribution` returns whichever identity mode is selected.
- Logs are emitted to `stderr` and JSON output is written to `stdout`, so CI redirection still works.
- You can set a default log level with `CODESENTINEL_LOG_LEVEL` (`silent|error|warn|info|debug`).
- At `info`/`debug`, structural, evolution, and dependency stages report progress so long analyses are observable.
- `--output summary` (default) prints a compact result for terminal use.
- `--output json` (or `--json`) prints the full analysis object.

When running through pnpm, pass CLI arguments after `--`:

```bash
pnpm dev -- analyze
pnpm dev -- analyze .
pnpm dev -- analyze ../project
pnpm dev -- analyze . --author-identity strict_email
```

## Understanding Analyze Output

`codesentinel analyze` returns one JSON document with four top-level blocks:

- `structural`: file dependency graph shape and graph metrics.
- `evolution`: git-derived change behavior per file and coupling pairs.
- `external`: dependency exposure for direct packages plus propagated transitive signals.
- `risk`: deterministic composition of `structural + evolution + external`.

Minimal shape:

```json
{
  "structural": { "...": "..." },
  "evolution": { "...": "..." },
  "external": { "...": "..." },
  "risk": {
    "repositoryScore": 0,
    "normalizedScore": 0,
    "hotspots": [],
    "fragileClusters": [],
    "dependencyAmplificationZones": []
  }
}
```

How to read `risk` first:

- `repositoryScore`: overall repository fragility index (`0..100`).
- `hotspots`: ranked files to inspect first.
- `fragileClusters`: groups of files with structural-cycle or co-change fragility.
- `dependencyAmplificationZones`: files where external dependency pressure intersects with local fragility.

Interpretation notes:

- Scores are deterministic for the same inputs and config.
- Scores are meant for within-repo prioritization and trend tracking.
- Full model details and limits are in `packages/risk-engine/README.md`.

### Score Guide

Use these ranges as operational guidance:

- `0-20`: low fragility.
- `20-40`: moderate fragility.
- `40-60`: elevated fragility (prioritize top hotspots).
- `60-80`: high fragility (expect higher change coordination cost).
- `80-100`: very high fragility (investigate immediately).

These ranges are heuristics for triage, not incident probability.

### What Moves Scores

`risk.repositoryScore` and `risk.fileScores[*].score` increase when:

- structurally central files/modules change frequently,
- ownership is highly concentrated in volatile files,
- files in central areas are exposed to high external dependency pressure,
- tightly coupled change patterns emerge.

They decrease when:

- change concentrates less around central files,
- ownership spreads or volatility decreases,
- dependency pressure decreases (shallower trees, fewer high-risk signals),
- hotspot concentration drops.

### External Risk Signal Semantics

For `external.dependencies`, each direct dependency now exposes three signal fields:

- `ownRiskSignals`: signals computed from that package itself.
- `inheritedRiskSignals`: signals propagated from transitive dependencies in its subtree.
- `riskSignals`: union of `ownRiskSignals` and `inheritedRiskSignals`.

Propagation policy is explicit and deterministic:

- `single_maintainer`: **not propagated**
  - Rationale: maintainer concentration is package-specific governance, not a transferable property.
- `abandoned`: **propagated**
  - Rationale: depending on abandoned transitive packages is still real operational exposure.
  - Note: `abandonedDependencies` list only includes packages with **own** `abandoned`.
- `high_centrality`: **propagated**
  - Rationale: highly central transitive packages can become systemic weak points for a parent dependency.
- `deep_chain`: **propagated**
  - Rationale: deep transitive trees increase update/debug complexity for top-level dependencies.
- `high_fanout`: **propagated**
  - Rationale: broad transitive fan-out increases blast radius and maintenance surface.
- `metadata_unavailable`: **not propagated**
  - Rationale: unknown metadata for one child should not automatically degrade parent classification.

This keeps package-level facts local while still surfacing meaningful transitive exposure.

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
