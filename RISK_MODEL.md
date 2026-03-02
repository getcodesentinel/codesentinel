# CodeSentinel Risk Model

## 1. Model Position

CodeSentinel produces an engineering risk estimate, not a probability forecast.

- `repositoryScore` and file/module/dependency scores are deterministic heuristics.
- Scores are designed for prioritization and trend tracking.
- Scores are not incident probability claims.

## 2. Determinism

For fixed inputs and configuration, output is deterministic.

- Same repository snapshot + same git history + same dependency metadata + same config => same scores.
- This is required for CI reproducibility and baseline diffing.

## 3. Composition Strategy

Risk is composed in layers:

1. Normalize raw signals into bounded factors in `[0,1]`.
2. Build per-file factors:
   - `structural`
   - `evolution`
   - `external`
3. Build file score from weighted baseline plus interaction terms.
4. Aggregate to repository/module/dependency outputs.

## 4. File-Level Scoring

Per-file factors:

- Structural factor uses fan-in, fan-out, graph depth, and cycle participation.
- Evolution factor uses commit count, churn, recent volatility, top-author share, and bus-factor risk.
- External factor is inferred from repository external pressure and local file affinity.
- Final file score combines base dimensions and amplifies specific high-risk intersections.
- Scores are bounded and normalized before being converted to a `0..100` range.

## 5. Repository Scoring

Repository dimensions:

- `structuralDimension = average(file.structural)`
- `evolutionDimension = average(file.evolution)`
- `externalDimension = repositoryExternalPressure`
- Repository scoring applies the same pattern as file scoring:
  - base dimensional composition,
  - targeted interaction amplification,
  - bounded normalization,
  - final `repositoryScore` in `0..100`.

## 6. External Dependency Pressure

Dependency scores are computed from:

- risk signals (own + inherited, with inherited multiplier),
- staleness,
- maintainer concentration,
- transitive burden,
- centrality,
- chain depth,
- bus-factor risk.

Popularity dampening (weekly downloads) is bounded and never overrides hard risk signals.

Repository external pressure is composed from:

- high percentile dependency risk,
- average dependency risk,
- overall dependency depth risk.

## 7. Output Schema (Current)

Risk summary output includes:

- `repositoryScore`
- `normalizedScore`
- `hotspots`
- `fragileClusters`
- `dependencyAmplificationZones`
- `fileScores`
- `moduleScores`
- `dependencyScores`

Optional explanation traces (`RiskTrace`) include per-target factor contributions and per-factor confidence values.

## 8. Confidence Semantics

Confidence is trace-level, not a top-level field in `RepositoryRiskSummary`.

- Factor traces include `confidence` in `[0,1]`.
- Report generation can derive aggregate confidence from trace contributions.
- Missing/partial evidence reduces confidence for affected factors.

## 9. Interpretation Guidelines

- Use `repositoryScore` for overall triage.
- Use `hotspots` for immediate remediation candidates.
- Use `fragileClusters` for structural/coupling refactors.
- Use `dependencyScores` and `dependencyAmplificationZones` for supply-chain pressure hotspots.

## 10. Non-Goals

- Predicting exact incident probability.
- Replacing static analysis, tests, or security scanners.
- Ranking engineer performance.

## 11. Future Extensions

- Calibration against historical failure/change-cost events.
- Policy packs for organization-specific thresholds/weights.
- Richer file-to-dependency attribution beyond inferred external pressure.
