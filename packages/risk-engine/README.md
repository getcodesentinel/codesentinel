# @codesentinel/risk-engine

Deterministic composition model for CodeSentinel risk scoring.

## Model

Risk is modeled as **change fragility**, not incident probability.

For each file:

1. Compute bounded factors `structural`, `evolution`, `external` in `[0,1]`.
2. Compute a weighted baseline:

   `baseline = ws*s + we*e + wx*x`

3. Apply saturating interaction terms:

   - `s * e` (complex + volatile)
   - `centrality * e` (central + unstable)
   - `x * max(s, e)` (external pressure amplification)

4. Convert to `[0,100]` score.

The saturation step prevents unbounded inflation and avoids double counting.

## Normalization

- Metrics with long-tail distributions use `log1p` before normalization.
- Normalization uses per-repo quantile clipping (default p05-p95).
- This limits outlier distortion and keeps medium/large repositories comparable.

## Default Coefficients

From `DEFAULT_RISK_ENGINE_CONFIG`:

- Dimension weights: `structural=0.44`, `evolution=0.36`, `external=0.20`
- Interaction weights: `structuralEvolution=0.35`, `centralInstability=0.25`, `dependencyAmplification=0.20`

Structural factor weights:

- `fanIn=0.30`, `fanOut=0.25`, `depth=0.20`, `cycleParticipation=0.25`

Evolution factor weights:

- `frequency=0.26`, `churn=0.24`, `recentVolatility=0.20`, `ownershipConcentration=0.18`, `busFactorRisk=0.12`

Dependency factor weights:

- `signals=0.38`, `staleness=0.16`, `maintainerConcentration=0.16`, `transitiveBurden=0.10`, `centrality=0.08`, `chainDepth=0.06`, `busFactorRisk=0.06`

## Output

Produces `RepositoryRiskSummary`:

- repository score and normalized score
- ranked file hotspots
- fragile clusters from structural cycles and coupling components
- dependency amplification zones
- file/module/dependency risk score tables

## How To Interpret Scores

`RepositoryRiskSummary` is intended for prioritization, not pass/fail gating.

Suggested triage bands:

- `0-20`: low fragility
- `20-40`: moderate fragility
- `40-60`: elevated fragility
- `60-80`: high fragility
- `80-100`: very high fragility

### Structural

Structural factor tends to increase with:

- higher `fanIn` (many dependents),
- higher `fanOut` (many dependencies),
- deeper graph position,
- participation in cycles.

It tends to decrease with flatter, less central dependency structure.

### Evolution

Evolution factor tends to increase with:

- higher commit frequency and churn,
- higher recent volatility,
- higher top-author concentration,
- lower bus factor.

It tends to decrease with stable change cadence and broader ownership.

### External

External factor tends to increase with:

- stronger dependency risk signals (`abandoned`, `single_maintainer`, etc.),
- deeper or broader transitive trees,
- higher dependency centrality,
- staleness and maintainer concentration.

External dependency scores may be mildly dampened by package popularity
(weekly npm downloads), but only as a bounded adjustment.
Popularity does not override hard signals such as `abandoned`, `single_maintainer`,
or `metadata_unavailable`.

At file level, external pressure is currently distributed by local structural/evolution context
rather than direct per-file import-to-package resolution.

### Interaction Effects

The model intentionally amplifies specific combinations:

- structural fragility × volatility,
- centrality × instability,
- external pressure × local fragility.

This is why a simple file can still rank high if it is central and frequently changed.

### How Scores Go Down

Typical reductions come from:

- reducing central chokepoints (split/shared-data extraction, boundary cleanup),
- lowering repeated churn in high-centrality files,
- increasing contributor spread on critical files,
- reducing dependency depth/fan-out and risky transitive inheritance.

## Interpretation Limits

- File-level external pressure is currently inferred:
  - External fragility is measured from dependency data.
  - The file `external` factor is distributed using structural centrality and evolution volatility.
  - It is not yet direct `file -> package -> transitive package` import resolution.
- `percentileRank` is optional and currently unset in normal runs:
  - The field is reserved for environments that provide an explicit baseline dataset.
  - Default behavior is within-repository prioritization, not global ranking.
- The model is deterministic but heuristic:
  - Coefficients are engineered and documented.
  - Scores are reproducible and explainable, but not statistical failure probabilities.
