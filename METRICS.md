# CodeSentinel Metrics Specification

## 1. Purpose

This document defines the metrics currently produced and consumed by the implementation.

Each metric describes:

- scope,
- unit,
- directionality (higher or lower increases risk),
- where it is used in scoring.

## 2. Scopes

Metrics are emitted at these scopes:

- `repository`
- `file`
- `module`
- `dependency`
- `file_pair` (change coupling)

## 3. Structural Metrics

### 3.1 Graph summary (`structural.metrics`)

- `nodeCount` (count): files/nodes in the dependency graph.
- `edgeCount` (count): directed import/dependency edges.
- `cycleCount` (count): strongly connected components with cycle semantics.
- `graphDepth` (count): longest DAG depth after SCC condensation.
- `maxFanIn` (count): maximum inbound edge count across files.
- `maxFanOut` (count): maximum outbound edge count across files.

### 3.2 Per-file structural (`structural.files[*]`)

- `fanIn` (count): number of files depending on this file.
- `fanOut` (count): number of files this file depends on.
- `depth` (count): graph depth index of the file.

Derived structural risk inputs:

- `cycleParticipation` (`0|1`): whether file belongs to any cycle.
- `fanInRisk`, `fanOutRisk`, `depthRisk` (`[0,1]` normalized).

Risk direction:

- higher `fanIn`, `fanOut`, `depth`, or cycle participation increases structural risk.

## 4. Evolutionary Metrics

### 4.1 Repository-level evolution (`evolution.metrics`)

- `totalCommits` (count)
- `totalFiles` (count)
- `headCommitTimestamp` (unix seconds or `null`)
- `recentWindowDays` (days, default `30`)
- `hotspotTopPercent` (ratio)
- `hotspotThresholdCommitCount` (count)

### 4.2 Per-file evolution (`evolution.files[*]`)

- `commitCount` (count)
- `frequencyPer100Commits` (count/100 commits)
- `churnAdded` (lines)
- `churnDeleted` (lines)
- `churnTotal` (lines)
- `recentCommitCount` (count within recent window)
- `recentVolatility` (`[0,1]`, recentCommitCount / commitCount)
- `topAuthorShare` (`[0,1]`)
- `busFactor` (count of authors needed to reach configured ownership threshold)
- `authorDistribution` (shares by author id)

### 4.3 Coupling and hotspots

- `hotspots`: ranked high-change files.
- `coupling.pairs[*].coChangeCommits` (count)
- `coupling.pairs[*].couplingScore` (`[0,1]`)

Derived evolution risk inputs:

- `frequencyRisk`, `churnRisk`, `volatilityRisk`, `ownershipConcentrationRisk`, `busFactorRisk` (`[0,1]`).

Risk direction:

- higher change/churn/volatility/top-author share increases risk.
- lower bus factor increases risk.

## 5. External Dependency Metrics

### 5.1 External summary (`external.metrics`)

- `totalDependencies` (count)
- `directDependencies` (count)
- `directProductionDependencies` (count)
- `directDevelopmentDependencies` (count)
- `transitiveDependencies` (count)
- `dependencyDepth` (count)
- `lockfileKind` (`pnpm|npm|npm-shrinkwrap|yarn|bun`)
- `metadataCoverage` (`[0,1]`)

### 5.2 Per-dependency (`external.dependencies[*]`, direct dependencies)

- topology:
  - `transitiveDependencies` (list), `dependencyDepth`, `fanOut`, `dependents`
- maintenance:
  - `maintainerCount`, `daysSinceLastRelease`, `releaseFrequencyDays`, `repositoryActivity30d`, `busFactor`
- popularity:
  - `weeklyDownloads`
- classification:
  - `ownRiskSignals`, `inheritedRiskSignals`, `riskSignals`

Derived dependency risk inputs:

- `signalScore`
- `stalenessRisk`
- `maintainerConcentrationRisk`
- `transitiveBurdenRisk`
- `centralityRisk`
- `chainDepthRisk`
- `busFactorRisk`
- `popularityDampener`

All derived inputs are bounded to `[0,1]`.

Risk direction:

- more/stronger risk signals, deeper/broader topology, stale releases, low maintainer/bus factor increase risk.
- popularity can only dampen risk up to a bounded maximum and does not override hard risk signals.

## 6. Risk Output Metrics

### 6.1 Repository risk (`risk`)

- `riskScore` (`0..100`)
  - Direction: higher means higher risk (worse)
- `normalizedScore` (`[0,1]`)
- `hotspots` (top-risk files)
- `fragileClusters` (structural cycle and coupling clusters)
- `dependencyAmplificationZones`

### 6.2 Repository quality (`quality`)

- `qualityScore` (`0..100`)
  - Direction: higher means better quality posture
- `normalizedScore` (`[0,1]`)
- `dimensions.modularity` (`0..100`)
- `dimensions.changeHygiene` (`0..100`)
- `dimensions.staticAnalysis` (`0..100`)
- `dimensions.complexity` (`0..100`)
- `dimensions.duplication` (`0..100`)
- `dimensions.testHealth` (`0..100`)
- `topIssues` (deterministic actionable issues with `id`, `severity`, `target`, and `dimension`)
- `trace` (dimension-level explainability factors with normalized metrics and evidence)

Quality dimension weights:

- `modularity`: `0.20`
- `changeHygiene`: `0.20`
- `staticAnalysis`: `0.20`
- `complexity`: `0.15`
- `duplication`: `0.10`
- `testHealth`: `0.15`

### 6.3 File/module/dependency risk tables

- `fileScores[*]`: `score`, `normalizedScore`, `factors.{structural,evolution,external}`
- `moduleScores[*]`: `score`, `normalizedScore`, `fileCount`
- `dependencyScores[*]`: `score`, `normalizedScore`, signal lists

## 7. Normalization

Implemented normalization behavior:

- long-tail count metrics are log-transformed with `log1p`,
- quantile clamp defaults to p05-p95,
- normalized values are clipped to `[0,1]`,
- scoring uses saturating composition to cap runaway amplification.

## 8. Confidence

Confidence is emitted in explanation traces (`RiskTrace` factor entries), not in the top-level risk summary.

- factor confidence is in `[0,1]`,
- confidence is reduced when relevant metadata/evidence is missing.

## 9. Non-Metrics

These are currently outside the core risk model:

- lint warning counts,
- test coverage percentages,
- issue/defect tracker counts.
