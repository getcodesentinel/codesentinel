# CodeSentinel Metrics Specification (Phase 0)

## 1. Purpose

This document specifies metric semantics independent of implementation details.

A metric must define:
- Entity scope.
- Observation window.
- Unit.
- Directionality (higher means safer or riskier).
- Confidence implications.

## 2. Entity Scopes

Supported scopes:
- `repository`
- `subsystem` (future: path prefix or declared boundary)
- `module` (file or logical module)

All metrics must declare valid scopes.

## 3. Observation Windows

Standard windows:
- Structural: snapshot at analysis time.
- Evolutionary: rolling windows (default 30/90/365 days).
- External: latest available metadata at analysis time.

Window definition is part of provenance and required for comparability.

## 4. Metric Taxonomy

## 4.1 Structural Metrics

1. `cycle_participation_ratio`
- Definition: fraction of modules participating in at least one cycle.
- Unit: ratio `[0,1]`.
- Risk direction: higher is riskier.

2. `cycle_edge_density`
- Definition: cycle edges divided by total edges.
- Unit: ratio `[0,1]`.
- Risk direction: higher is riskier.

3. `fan_in_p95`
- Definition: 95th percentile inbound dependency count per module.
- Unit: count.
- Risk direction: higher is riskier (change blast radius proxy).

4. `fan_out_p95`
- Definition: 95th percentile outbound dependency count per module.
- Unit: count.
- Risk direction: higher is riskier (complexity proxy).

5. `instability_index`
- Definition: normalized ratio approximating outbound/(inbound+outbound).
- Unit: ratio `[0,1]`.
- Risk direction: context dependent; extreme values are penalized by role policy.

6. `cross_boundary_dependency_ratio` (future boundary annotations)
- Definition: edges crossing declared architectural boundaries / total edges.
- Unit: ratio `[0,1]`.
- Risk direction: higher is riskier.

## 4.2 Evolutionary Metrics

1. `change_frequency`
- Definition: commits touching entity per window.
- Unit: count per window.
- Risk direction: higher is riskier beyond baseline.

2. `hotspot_score`
- Definition: normalized concentration of churn and complexity proxies.
- Unit: ratio `[0,1]`.
- Risk direction: higher is riskier.

3. `ownership_concentration`
- Definition: share of changes authored by top contributor.
- Unit: ratio `[0,1]`.
- Risk direction: higher is riskier.

4. `effective_authors`
- Definition: entropy-based equivalent number of contributors.
- Unit: effective count.
- Risk direction: lower is riskier.

5. `volatility_acceleration`
- Definition: second-order trend of change frequency.
- Unit: normalized slope.
- Risk direction: higher is riskier.

## 4.3 External Dependency Metrics

1. `transitive_dependency_count`
- Definition: number of transitive packages reachable from direct dependencies.
- Unit: count.
- Risk direction: higher is riskier (exposure surface).

2. `stale_dependency_ratio`
- Definition: share of dependencies exceeding staleness threshold.
- Unit: ratio `[0,1]`.
- Risk direction: higher is riskier.

3. `maintainer_concentration`
- Definition: concentration proxy for package stewardship.
- Unit: ratio `[0,1]`.
- Risk direction: higher is riskier.

4. `release_cadence_irregularity`
- Definition: instability in release intervals.
- Unit: normalized variance proxy.
- Risk direction: higher is riskier.

5. `deprecated_dependency_ratio`
- Definition: share of dependencies explicitly marked deprecated.
- Unit: ratio `[0,1]`.
- Risk direction: higher is riskier.

## 5. Normalization Rules

To preserve composability, each metric is transformed into a normalized factor in `[0,1]`.

Rules:
1. Normalization functions are versioned and deterministic.
2. Nonlinear transforms are allowed where risk is thresholded or saturating.
3. For metrics where both extremes are risky, use U-shaped penalty functions.
4. Missing metric values produce `unknown` factor state, not implicit zero.

## 6. Confidence and Data Quality

Each metric observation includes confidence components:
- `coverage`: observed entities / expected entities.
- `freshness`: age relative to accepted window.
- `stability`: sensitivity to small input perturbations.

Confidence is represented as `[0,1]` and propagated to factor level.

## 7. Cross-Metric Constraints

1. A metric cannot invert directionality between runs without schema version change.
2. Unit changes require metric ID versioning.
3. Metrics must remain explainable to engineers reviewing risk outputs.
4. Correlated metrics may coexist, but composition must guard against double counting.

## 8. Explicit Non-Metrics

The following are not first-class risk metrics in Phase 0:
- Lint warning counts.
- Test coverage percentages.
- Raw defect ticket counts.

These may be integrated later as auxiliary context, not core structural risk factors.
