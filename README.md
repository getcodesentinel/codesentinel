<p align="center">
  <img src="assets/codesentinel-logo.png" alt="CodeSentinel logo" width="180" />
</p>
<h1 align="center">CodeSentinel</h1>
<p align="center">
  <a href="https://github.com/getcodesentinel/codesentinel/actions/workflows/release.yml"><img src="https://github.com/getcodesentinel/codesentinel/actions/workflows/release.yml/badge.svg?branch=main" alt="Release" /></a>&nbsp;
  <a href="https://www.npmjs.com/package/@getcodesentinel/codesentinel"><img src="https://img.shields.io/npm/v/@getcodesentinel/codesentinel" alt="npm version" /></a>&nbsp;
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white" alt="Node.js >=22" /></a>&nbsp;
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
</p>

CodeSentinel is a structural and evolutionary risk analysis engine for modern TypeScript/JavaScript codebases. It turns architecture, change history, and dependency health into a unified risk model that helps engineering teams spot fragility before it becomes failure.

This repository contains the CodeSentinel monorepo, with structural, evolution, external dependency, and deterministic risk analysis engines exposed through a CLI.

## Vision

CodeSentinel combines three signals into a single, explainable risk profile:

- **Structural risk**: dependency graph topology, cycles, coupling, fan-in/fan-out, boundary violations.
- **Evolutionary risk**: change frequency, hotspots, bus factor, volatility.
- **External risk**: transitive dependency exposure, maintainer risk, staleness and abandonment indicators.
  - Includes bounded popularity dampening (weekly npm downloads) as a secondary stability signal.

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

- Node.js 22+
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
npm install -g @getcodesentinel/codesentinel
```

Then run:

```bash
codesentinel analyze [path]
codesentinel explain [path]
codesentinel dependency-risk <dependency[@version]>
```

Examples:

```bash
codesentinel analyze
codesentinel analyze .
codesentinel analyze ../project
codesentinel explain
codesentinel explain . --top 5 --format text
codesentinel explain . --file src/app/page.tsx
codesentinel explain . --module src/components
codesentinel dependency-risk react
codesentinel dependency-risk react@19.0.0
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

# Explain top hotspots with narrative output
codesentinel explain .

# Explain a specific file
codesentinel explain . --file src/app/page.tsx

# Explain a specific module
codesentinel explain . --module src/components

# Explain in markdown or json
codesentinel explain . --format md
codesentinel explain . --format json
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
pnpm dev -- explain
pnpm dev -- explain . --top 5 --format text
pnpm dev -- explain . --file src/app/page.tsx
```

## Explain Output

`codesentinel explain` uses the same risk-engine scoring model as `analyze` and adds structured explanation traces.

Text/markdown output includes:

- repository score and risk band (`low|moderate|high|very_high`)
- plain-language primary drivers
- concrete evidence values behind those drivers
- intersected signals (composite interaction terms)
- prioritized reduction actions
- per-target breakdowns (repository/file/module/dependency, depending on selection)

Filters:

- `--file <path>`: explain one file target.
- `--module <name>`: explain one module target.
- `--top <n>`: explain top `n` hotspot files (default behavior when no file/module is provided).
- `--format text|json|md`: render narrative text, full JSON payload, or markdown.

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

Data source notes:

- Lockfile-first extraction supports `pnpm-lock.yaml`, `package-lock.json` / `npm-shrinkwrap.json`, `yarn.lock`, and `bun.lock`.
- If no lockfile is present, CodeSentinel attempts a bounded npm registry graph resolution from direct dependencies.
- npm weekly download metadata is fetched only for direct dependencies (not all transitive nodes).

Classification lists:

- `highRiskDependencies`: **production** direct packages classified from strong **own** signals (not inherited-only signals).
- `highRiskDevelopmentDependencies`: same classification model for direct development dependencies.
- `transitiveExposureDependencies`: direct packages carrying inherited transitive exposure signals.

Current high-risk rule for direct dependencies:

- mark high-risk if own signals include `abandoned`, or
- mark high-risk if at least two of own signals are in `{high_centrality, deep_chain, high_fanout}`, or
- mark high-risk if own signals include `single_maintainer` and the package is stale (>= half abandoned threshold) or has no recent repository activity signal.

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

## ESM Import Policy

- The workspace uses `TypeScript` with `moduleResolution: "NodeNext"` and ESM output.
- For local relative imports, use `.js` specifiers in source files (example: `import { x } from "./x.js"`).
- Do not use `.ts` specifiers for runtime imports in package source files.
- This keeps emitted code and runtime resolution aligned with Node.js ESM behavior.

## License

MIT
