# CodeSentinel Architecture (Phase 0 Domain RFC)

## 1. Scope

This document defines the conceptual model for CodeSentinel.

In scope:
- Domain language and core entities.
- Module boundaries and interaction contracts.
- Risk semantics and system-level invariants.
- Extensibility constraints for future engines and plugins.

Out of scope:
- Concrete algorithm implementation.
- Storage schema details.
- UI/UX and visualization details.
- Performance benchmarks.

## 2. What "Risk" Means in CodeSentinel

For this system, risk is:

`Risk = expected maintenance or delivery disruption caused by code structure, code evolution, and external dependency exposure, conditioned on current repository evidence.`

Important consequences:
- Risk is not equivalent to defects. A low-defect module can still be high-risk if change-coupled and concentrated in few owners.
- Risk is about future fragility under change, not current runtime health.
- Risk is assessed at multiple granularities: repository, subsystem, module/file.

## 3. Core Domain Terms

- `Analysis Target`: filesystem root of the repository being analyzed.
- `Module`: a logical code unit in the analyzed graph. Initially path-based; may later support semantic module mapping.
- `Dependency Edge`: directed relation `A -> B` where A depends on B.
- `Structural Signal`: metric derived from graph topology (cycles, fan-in/out, coupling).
- `Evolutionary Signal`: metric derived from VCS history (frequency, hotspots, ownership concentration).
- `External Signal`: metric derived from third-party dependency metadata.
- `Signal Observation`: single measured value with provenance and confidence.
- `Risk Factor`: normalized interpretation of one or more signal observations.
- `Risk Vector`: tuple of dimension scores (structural, evolutionary, external).
- `Risk Profile`: final composite assessment for an entity, including score and explanation.
- `Confidence`: estimate of how representative the observed evidence is for scoring.

## 4. Domain Boundaries and Responsibilities

### 4.1 `@codesentinel/core`

Responsibility:
- Canonical domain types, analysis contracts, and shared value objects.
- Cross-package invariants (normalization ranges, identity types, evidence metadata).

Must not:
- Depend on adapters (git process execution, npm registry APIs).

### 4.2 `@codesentinel/code-graph`

Responsibility:
- Build and validate internal dependency graph.
- Emit structural observations (cycles, centrality proxies, coupling metrics).

Boundary:
- Consumes source tree and parsing configuration.
- Produces graph and structural observations only.

### 4.3 `@codesentinel/git-analyzer`

Responsibility:
- Derive evolutionary observations from commit history.
- Compute change cadence, hotspot concentration, contributor distribution.

Boundary:
- No scoring. No structural graph responsibilities.

### 4.4 `@codesentinel/dependency-firewall`

Responsibility:
- Derive external exposure observations from dependency manifests and lockfiles.
- Model staleness, transitive expansion, maintainer/health proxies.

Boundary:
- No scoring. No code graph or git heuristics.

### 4.5 `@codesentinel/risk-engine`

Responsibility:
- Transform observations into normalized factors.
- Compose factors into risk vectors and final risk profiles.
- Track confidence and explanation traces.

Boundary:
- Pure domain logic. Must remain adapter-independent.

### 4.6 `@codesentinel/reporter`

Responsibility:
- Render risk profiles into machine/human outputs.
- Preserve explanation trace and factor contributions.

Boundary:
- No scoring logic.

### 4.7 `@codesentinel/cli`

Responsibility:
- Orchestrate pipeline and runtime concerns.
- Validate inputs, select output mode, invoke packages.

Boundary:
- CLI is composition root, not business logic owner.

## 5. High-Level Package Interaction Diagram

```text
+-------------------+
| @codesentinel/cli |
+---------+---------+
          |
          v
+--------------------+         +-------------------------+
| @codesentinel/core |<--------| all domain packages use |
+---------+----------+         | shared contracts/types  |
          |                    +-------------------------+
          |
          +---------------------------------------------+
          |                                             |
          v                                             v
+---------------------------+                 +---------------------------+
| @codesentinel/code-graph  |                 | @codesentinel/git-analyzer|
+-------------+-------------+                 +-------------+-------------+
              |                                             |
              +-------------------+   +---------------------+
                                  v   v
                           +-------------------------------+
                           | @codesentinel/risk-engine     |
                           | compose + normalize + explain |
                           +---------------+---------------+
                                           |
                                           v
                           +-------------------------------+
                           | @codesentinel/reporter        |
                           +-------------------------------+

External dependency signals flow in parallel:

@codesentinel/dependency-firewall ---> @codesentinel/risk-engine
```

Dependency direction invariants:
- `cli -> (core, analyzers, risk-engine, reporter)`
- `risk-engine -> core`
- `analyzers -> core`
- `reporter -> core`
- `core -> no internal package`

## 6. Architectural Principles

1. Evidence before scoring: raw observations must be queryable independently from final score.
2. Explainability over opaque optimization: each risk contribution must be auditable.
3. Deterministic baseline: same input snapshot yields same output.
4. Explicit confidence: low-quality evidence lowers confidence, not silently ignored.
5. Composable dimensions: structural/evolutionary/external dimensions remain separable.
6. Monotonic semantics: worsening factors should not reduce risk absent explicit damping rule.
7. Adapter isolation: external systems (git, registry) are replaceable boundaries.

## 7. Non-Goals (Phase 0)

- Predicting incident probability with statistical guarantees.
- Auto-remediation or automated refactoring.
- Style/lint rule enforcement.
- Security vulnerability scanning replacement.
- Language-agnostic analysis beyond JS/TS.

## 8. Extensibility Model

Future extensibility targets:
- Additional analyzers producing `SignalObservation` under stable contracts.
- Configurable factor weighting policy per organization profile.
- Plugin lifecycle hooks at `collect -> normalize -> compose -> report`.

Extension constraints:
- New signals must declare unit, directionality, and confidence semantics.
- Plugins cannot mutate canonical observations in-place; only append derived factors.
- Core scoring contracts must remain backward-compatible through versioned schemas.

## 9. Invariants and Assumptions

### Invariants

1. Every risk score must be traceable to concrete observations.
2. Every observation has provenance (`source`, `timestamp/window`, `entity`).
3. Normalized factor values are bounded to `[0, 1]`.
4. Final score range is fixed to `[0, 100]`.
5. Missing evidence is explicit and influences confidence.
6. Composition is deterministic for a fixed configuration and dataset.
7. No package may introduce circular dependencies.

### Assumptions

1. Git history is available and sufficiently complete for trend extraction.
2. Lockfile/manifests are present for dependency analysis.
3. Path/module mapping is stable enough to join signals across dimensions.
4. Organizations can tolerate heuristic scores if explanations are transparent.
5. Initial use focuses on comparative risk ranking, not absolute certification.

## 10. Tensions and Weak Spots in Current Vision

1. "Bus factor" from git identity is noisy due to aliasing and bot activity.
   Improvement: require identity normalization policy and bot filtering strategy.
2. "Maintainer risk" is hard to infer reliably from public metadata alone.
   Improvement: model as low-confidence proxy unless corroborated by multiple signals.
3. Structural metrics may over-penalize framework glue code.
   Improvement: support boundary annotations and module role classification.
