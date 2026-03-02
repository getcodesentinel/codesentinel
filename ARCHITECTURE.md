# CodeSentinel Architecture

## 1. Scope

This document defines the current conceptual architecture for CodeSentinel.

In scope:
- domain language and core entities,
- package boundaries and interaction contracts,
- scoring and reporting data flow,
- invariants for deterministic analysis.

Out of scope:
- UI/visualization design,
- storage backends,
- performance benchmarking methodology.

## 2. Risk Semantics

CodeSentinel models risk as expected delivery or maintenance disruption under future change.

Risk is not:
- a defect count,
- a runtime health check,
- an incident probability estimate.

Risk is produced at multiple levels:
- repository,
- file,
- module,
- dependency.

## 3. Package Boundaries

### 3.1 `@codesentinel/core`

Responsibility:
- canonical shared types and contracts,
- cross-package schema consistency.

Must not:
- depend on analyzers or adapters.

### 3.2 `@codesentinel/code-graph`

Responsibility:
- parse project structure,
- build dependency graph,
- emit structural metrics and cycles.

### 3.3 `@codesentinel/git-analyzer`

Responsibility:
- analyze git history,
- emit churn, ownership, hotspot, and coupling metrics.

### 3.4 `@codesentinel/dependency-firewall`

Responsibility:
- extract direct/transitive dependency graph from lockfiles or registry fallback,
- derive dependency risk signals and external exposure metrics.

### 3.5 `@codesentinel/risk-engine`

Responsibility:
- normalize and compose structural/evolution/external signals,
- produce repository/file/module/dependency risk scores,
- optionally emit explanation traces.

Constraint:
- pure scoring domain logic; no direct CLI/runtime concerns.

### 3.6 `@codesentinel/reporter`

Responsibility:
- convert analysis + optional trace/diff into report and snapshot artifacts,
- render `text`, `md`, and `json` output formats.

### 3.7 `@codesentinel/governance`

Responsibility:
- evaluate CI gates against current analysis and optional baseline diff,
- return deterministic violations and exit codes,
- resolve auto baseline strategies for CI workflows.

### 3.8 `@codesentinel/cli`

Responsibility:
- composition root for end-user commands (`analyze`, `explain`, `report`, `check`, `ci`, `dependency-risk`),
- parse and validate runtime options,
- orchestrate analyzer, risk, report, and governance flows.

## 4. High-Level Flow

```text
@codesentinel/cli
  -> collect structural/evolution/external analysis
  -> @codesentinel/risk-engine (risk summary / optional trace)
  -> @codesentinel/reporter (snapshot/report rendering)
  -> @codesentinel/governance (gate evaluation in check/ci flows)
```

All packages share contracts from `@codesentinel/core`.

## 5. Dependency Direction Invariants

- `cli -> (core, code-graph, git-analyzer, dependency-firewall, risk-engine, reporter, governance)`
- `risk-engine -> core`
- `reporter -> core`
- `governance -> (core, reporter)`
- `code-graph -> core`
- `git-analyzer -> core`
- `dependency-firewall -> core`
- `core -> no internal package`

No circular package dependencies are allowed.

## 6. Architectural Principles

1. Determinism: fixed inputs/config produce fixed outputs.
2. Explainability: score contributors are inspectable through trace data.
3. Separation of concerns: collection, scoring, rendering, and gating stay isolated.
4. Bounded scoring: normalized factors remain in `[0,1]`; headline scores remain in `0..100`.
5. Baseline safety: CI comparison and auto-baseline behavior should not mutate the working tree.

## 7. Invariants and Assumptions

Invariants:
1. Every reported score is derived from explicit collected evidence.
2. Risk summary schema remains stable and versioned across report/snapshot artifacts.
3. Missing evidence is explicit (unavailable analysis branches and reduced trace confidence).

Assumptions:
1. Git history is available for repositories where evolution analysis is expected.
2. Dependency manifests/lockfiles are available, or registry fallback is acceptable.
3. Path-based module grouping is sufficient for baseline repository-level prioritization.

## 8. Non-Goals

- replacing static analysis, tests, or security scanners,
- enforcing architectural policy directly inside analyzers,
- ranking individual engineer performance.
