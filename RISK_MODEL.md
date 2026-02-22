# CodeSentinel Risk Model (Phase 0)

## 1. Model Position

CodeSentinel produces an engineering risk estimate, not a truth claim.

Formal interpretation:
- `Risk score` is a calibrated heuristic index of change fragility.
- It estimates relative disruption likelihood under ongoing development.
- It is intended for prioritization and trend tracking, not certification.

## 2. Deterministic vs Probabilistic

Decision:
- The Phase 0 model is deterministic given fixed inputs and configuration.

Rationale:
1. Determinism is required for CI reproducibility and regression tracking.
2. Available signals do not justify statistically valid probability claims.
3. Deterministic scores with explicit confidence are easier to audit.

Implication:
- We avoid language like "this module has 73% chance of failure".
- We use "this module has high relative risk with medium confidence".

## 3. Composition Strategy

Decision:
- Use weighted compositional scoring, not naive additive summation.

Model structure:
1. Compute normalized factors per signal (`[0,1]`).
2. Aggregate factors within each dimension into dimension score (`[0,100]`).
3. Compose dimension scores with configurable weights and gating rules.
4. Output final score plus dimension vector and confidence.

Why not plain additive:
- Additive models hide interaction effects (e.g., structural fragility + high churn should amplify risk).
- Additive models are prone to double counting correlated metrics.

Compositional rules (Phase 0):
- Weighted baseline across dimensions.
- Interaction gates for specific high-risk conjunctions.
- Saturation caps to prevent runaway inflation from redundant factors.

## 4. Risk Vector Semantics

Risk profile output includes:
- `structural_score`
- `evolutionary_score`
- `external_score`
- `overall_score`
- `confidence`
- `explanation_trace`

Interpretation model:
- `overall_score` ranks urgency.
- Dimension scores indicate remediation direction.
- Confidence determines how strongly to trust ranking decisions.

## 5. Confidence Model

Confidence is independent from score magnitude.

Examples:
- High score + low confidence: triage candidate requiring data-quality check.
- Moderate score + high confidence: stable signal, suitable for planning.

Confidence penalties apply when:
- History window is too short.
- Dependency metadata is missing/inconsistent.
- Module mapping is ambiguous.

## 6. Tradeoffs and Design Choices

### Choice A: Relative index vs calibrated probability

Selected: relative index.

Tradeoff:
- Pros: explainable, deterministic, practical with limited data.
- Cons: cannot be interpreted as actuarial probability.

### Choice B: Fixed global weights vs configurable policy

Selected: stable defaults with optional policy override.

Tradeoff:
- Pros: comparability across repositories by default.
- Cons: domain-specific environments may need tailored weighting.

### Choice C: Dimension separation vs single latent model

Selected: explicit dimension separation.

Tradeoff:
- Pros: actionable diagnostics, lower opacity.
- Cons: potentially less compact than latent ML models.

## 7. What Differentiates CodeSentinel from Static Analyzers

Static analyzers typically answer:
- "Is this code violating a rule right now?"

CodeSentinel answers:
- "Where is change likely to be costly or destabilizing next?"

Differentiators:
1. Joint model: combines structural, temporal, and external supply signals.
2. Evolution-aware: includes history and ownership concentration, not only snapshot code shape.
3. Risk composition: outputs prioritization index with explanation trace.
4. Confidence-aware: treats missing/noisy evidence explicitly.

## 8. Explicit Non-Goals

- Replacing static analysis, tests, or security scanners.
- Estimating exact incident probabilities.
- Ranking engineer performance.
- Enforcing architecture through hard policy gates in Phase 0.

## 9. Weaknesses and Mitigations

1. Heuristic bias risk.
- Mitigation: versioned normalization and periodic calibration reviews.

2. Data quality sensitivity.
- Mitigation: first-class confidence and explicit missing-evidence accounting.

3. Metric gaming potential.
- Mitigation: multi-signal composition and trend-based evaluation over single snapshots.

## 10. Assumptions for Phase 0

1. Repository history reflects real development behavior (not heavily squashed/rewritten).
2. Dependency manifests represent actual production dependencies.
3. Architectural boundaries can eventually be declared or inferred with acceptable precision.
4. Teams will consume risk as decision support, not automated verdict.

## 11. Future Extensions

1. Calibration pipeline using historical incidents/change failures.
2. Organization-specific policy packs for weighting and thresholds.
3. Domain-specific suppressions (generated code, framework glue, vendored paths).
4. Optional probabilistic layer on top of deterministic baseline once data quality supports it.
