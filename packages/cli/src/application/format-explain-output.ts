import type { AnalyzeSummary, RiskFactorTrace, RiskTrace, TargetTrace } from "@codesentinel/core";
import type { ExplainFormat } from "./run-explain-command.js";

export type ExplainOutputPayload = {
  summary: AnalyzeSummary;
  trace: RiskTrace;
  selectedTargets: readonly TargetTrace[];
};

const sortFactorByContribution = (left: RiskFactorTrace, right: RiskFactorTrace): number =>
  right.contribution - left.contribution || left.factorId.localeCompare(right.factorId);

const toRiskBand = (score: number): "low" | "moderate" | "high" | "very_high" => {
  if (score < 25) {
    return "low";
  }
  if (score < 50) {
    return "moderate";
  }
  if (score < 75) {
    return "high";
  }
  return "very_high";
};

const factorLabelById: Readonly<Record<string, string>> = {
  "repository.structural": "Structural complexity",
  "repository.evolution": "Change volatility",
  "repository.external": "External dependency pressure",
  "repository.composite.interactions": "Intersection amplification",
  "file.structural": "File structural complexity",
  "file.evolution": "File change volatility",
  "file.external": "File external pressure",
  "file.composite.interactions": "File interaction amplification",
  "module.average_file_risk": "Average file risk",
  "module.peak_file_risk": "Peak file risk",
  "dependency.signals": "Dependency risk signals",
  "dependency.staleness": "Dependency staleness",
  "dependency.maintainer_concentration": "Maintainer concentration",
  "dependency.topology": "Dependency topology pressure",
  "dependency.bus_factor": "Dependency bus factor",
  "dependency.popularity_dampening": "Popularity dampening",
};

const formatFactorLabel = (factorId: string): string => factorLabelById[factorId] ?? factorId;

const formatNumber = (value: number | null | undefined): string =>
  value === null || value === undefined ? "n/a" : `${value}`;

const formatFactorSummary = (factor: RiskFactorTrace): string =>
  `${formatFactorLabel(factor.factorId)} (+${factor.contribution}, confidence=${factor.confidence})`;

const formatFactorEvidence = (factor: RiskFactorTrace): string => {
  if (factor.factorId === "repository.structural") {
    return `structural dimension=${formatNumber(factor.rawMetrics["structuralDimension"])}`;
  }

  if (factor.factorId === "repository.evolution") {
    return `evolution dimension=${formatNumber(factor.rawMetrics["evolutionDimension"])}`;
  }

  if (factor.factorId === "repository.external") {
    return `external dimension=${formatNumber(factor.rawMetrics["externalDimension"])}`;
  }

  if (factor.factorId === "repository.composite.interactions") {
    return `structural×evolution=${formatNumber(factor.rawMetrics["structuralEvolution"])}, central instability=${formatNumber(factor.rawMetrics["centralInstability"])}, dependency amplification=${formatNumber(factor.rawMetrics["dependencyAmplification"])}`;
  }

  if (factor.factorId === "file.structural") {
    return `fanIn=${formatNumber(factor.rawMetrics["fanIn"])}, fanOut=${formatNumber(factor.rawMetrics["fanOut"])}, depth=${formatNumber(factor.rawMetrics["depth"])}, inCycle=${formatNumber(factor.rawMetrics["cycleParticipation"])}`;
  }

  if (factor.factorId === "file.evolution") {
    return `commitCount=${formatNumber(factor.rawMetrics["commitCount"])}, churnTotal=${formatNumber(factor.rawMetrics["churnTotal"])}, recentVolatility=${formatNumber(factor.rawMetrics["recentVolatility"])}`;
  }

  if (factor.factorId === "file.external") {
    return `repositoryExternalPressure=${formatNumber(factor.rawMetrics["repositoryExternalPressure"])}, dependencyAffinity=${formatNumber(factor.rawMetrics["dependencyAffinity"])}`;
  }

  if (factor.factorId === "file.composite.interactions") {
    return `structural×evolution=${formatNumber(factor.rawMetrics["structuralEvolutionInteraction"])}, central instability=${formatNumber(factor.rawMetrics["centralInstabilityInteraction"])}, dependency amplification=${formatNumber(factor.rawMetrics["dependencyAmplificationInteraction"])}`;
  }

  return "evidence available in trace";
};

const findRepositoryTarget = (targets: readonly TargetTrace[]): TargetTrace | undefined =>
  targets.find((target) => target.targetType === "repository");

const buildRepositoryActions = (payload: ExplainOutputPayload, repositoryTarget: TargetTrace | undefined): readonly string[] => {
  if (repositoryTarget === undefined) {
    return ["No repository trace available."];
  }

  const topHotspots = payload.summary.risk.hotspots.slice(0, 3).map((hotspot) => hotspot.file);
  const highRiskDependencies =
    payload.summary.external.available
      ? payload.summary.external.highRiskDependencies.slice(0, 3)
      : [];

  const actions: string[] = [];
  for (const lever of repositoryTarget.reductionLevers) {
    if (lever.factorId === "repository.evolution") {
      actions.push(
        `Reduce volatility/churn in top hotspots first: ${topHotspots.join(", ") || "no hotspots available"}.`,
      );
      continue;
    }

    if (lever.factorId === "repository.structural") {
      actions.push(
        `Lower fan-in/fan-out and break cycles in central files: ${topHotspots.join(", ") || "no hotspots available"}.`,
      );
      continue;
    }

    if (lever.factorId === "repository.composite.interactions") {
      actions.push(
        "Stabilize central files before refactors; interaction effects are amplifying risk.",
      );
      continue;
    }

    if (lever.factorId === "repository.external") {
      actions.push(
        `Review high-risk direct dependencies: ${highRiskDependencies.join(", ") || "none detected"}.`,
      );
      continue;
    }
  }

  if (actions.length === 0) {
    actions.push("No clear reduction levers available from current trace.");
  }

  return actions.slice(0, 3);
};

const renderTargetText = (target: TargetTrace): string => {
  const lines: string[] = [];
  lines.push(`${target.targetType}: ${target.targetId}`);
  lines.push(`  score: ${target.totalScore} (${target.normalizedScore})`);
  lines.push("  top factors:");

  const topFactors = [...target.factors].sort(sortFactorByContribution).slice(0, 5);
  for (const factor of topFactors) {
    lines.push(
      `    - ${formatFactorSummary(factor)}`,
    );
    lines.push(
      `      evidence: ${formatFactorEvidence(factor)}`,
    );
  }

  lines.push("  reduction levers:");
  for (const lever of target.reductionLevers) {
    lines.push(
      `    - ${formatFactorLabel(lever.factorId)} | estimatedImpact=${lever.estimatedImpact}`,
    );
  }

  return lines.join("\n");
};

const renderText = (payload: ExplainOutputPayload): string => {
  const lines: string[] = [];
  const repositoryTarget = findRepositoryTarget(payload.selectedTargets) ??
    findRepositoryTarget(payload.trace.targets);
  const repositoryTopFactors =
    repositoryTarget === undefined
      ? []
      : [...repositoryTarget.factors].sort(sortFactorByContribution).slice(0, 3);
  const compositeFactors = repositoryTopFactors.filter((factor) => factor.family === "composite");

  lines.push(`target: ${payload.summary.structural.targetPath}`);
  lines.push(`repositoryScore: ${payload.summary.risk.repositoryScore}`);
  lines.push(`riskBand: ${toRiskBand(payload.summary.risk.repositoryScore)}`);
  lines.push(`selectedTargets: ${payload.selectedTargets.length}`);
  lines.push("");
  lines.push("explanation:");
  lines.push(
    `  why risky: ${repositoryTopFactors.map(formatFactorSummary).join("; ") || "insufficient data"}`,
  );
  lines.push(
    `  what specifically contributed: ${repositoryTopFactors.map((factor) => `${formatFactorLabel(factor.factorId)}=${factor.contribution}`).join(", ") || "insufficient data"}`,
  );
  lines.push(
    `  dominant factors: ${repositoryTopFactors.map((factor) => formatFactorLabel(factor.factorId)).join(", ") || "insufficient data"}`,
  );
  lines.push(
    `  intersected signals: ${compositeFactors.map((factor) => `${formatFactorLabel(factor.factorId)} [${formatFactorEvidence(factor)}]`).join("; ") || "none"}`,
  );
  lines.push(
    `  what could reduce risk most: ${buildRepositoryActions(payload, repositoryTarget).join(" ")}`,
  );
  lines.push("");

  for (const target of payload.selectedTargets) {
    lines.push(renderTargetText(target));
    lines.push("");
  }

  return lines.join("\n").trimEnd();
};

const renderMarkdown = (payload: ExplainOutputPayload): string => {
  const lines: string[] = [];
  const repositoryTarget = findRepositoryTarget(payload.selectedTargets) ??
    findRepositoryTarget(payload.trace.targets);
  const repositoryTopFactors =
    repositoryTarget === undefined
      ? []
      : [...repositoryTarget.factors].sort(sortFactorByContribution).slice(0, 3);
  const compositeFactors = repositoryTopFactors.filter((factor) => factor.family === "composite");

  lines.push(`# CodeSentinel Explanation`);
  lines.push(`- target: \`${payload.summary.structural.targetPath}\``);
  lines.push(`- repositoryScore: \`${payload.summary.risk.repositoryScore}\``);
  lines.push(`- riskBand: \`${toRiskBand(payload.summary.risk.repositoryScore)}\``);
  lines.push(`- selectedTargets: \`${payload.selectedTargets.length}\``);
  lines.push("");
  lines.push(`## Summary`);
  lines.push(
    `- why risky: ${repositoryTopFactors.map(formatFactorSummary).join("; ") || "insufficient data"}`,
  );
  lines.push(
    `- what specifically contributed: ${repositoryTopFactors.map((factor) => `${formatFactorLabel(factor.factorId)}=${factor.contribution}`).join(", ") || "insufficient data"}`,
  );
  lines.push(
    `- dominant factors: ${repositoryTopFactors.map((factor) => formatFactorLabel(factor.factorId)).join(", ") || "insufficient data"}`,
  );
  lines.push(
    `- intersected signals: ${compositeFactors.map((factor) => `${formatFactorLabel(factor.factorId)} [${formatFactorEvidence(factor)}]`).join("; ") || "none"}`,
  );
  lines.push(
    `- what could reduce risk most: ${buildRepositoryActions(payload, repositoryTarget).join(" ")}`,
  );
  lines.push("");

  for (const target of payload.selectedTargets) {
    lines.push(`## ${target.targetType}: \`${target.targetId}\``);
    lines.push(`- score: \`${target.totalScore}\` (\`${target.normalizedScore}\`)`);
    lines.push(`- dominantFactors: \`${target.dominantFactors.join(", ")}\``);
    lines.push(`- Top factors:`);
    for (const factor of [...target.factors].sort(sortFactorByContribution).slice(0, 5)) {
      lines.push(
        `  - \`${formatFactorLabel(factor.factorId)}\` contribution=\`${factor.contribution}\` confidence=\`${factor.confidence}\``,
      );
      lines.push(
        `    - evidence: \`${formatFactorEvidence(factor)}\``,
      );
    }
    lines.push(`- Reduction levers:`);
    for (const lever of target.reductionLevers) {
      lines.push(
        `  - \`${formatFactorLabel(lever.factorId)}\` estimatedImpact=\`${lever.estimatedImpact}\``,
      );
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
};

export const formatExplainOutput = (
  payload: ExplainOutputPayload,
  format: ExplainFormat,
): string => {
  if (format === "json") {
    return JSON.stringify(payload, null, 2);
  }

  if (format === "md") {
    return renderMarkdown(payload);
  }

  return renderText(payload);
};
