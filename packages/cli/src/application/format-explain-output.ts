import type { AnalyzeSummary, RiskFactorTrace, RiskTrace, TargetTrace } from "@codesentinel/core";
import type { ExplainFormat } from "./run-explain-command.js";

export type ExplainOutputPayload = {
  summary: AnalyzeSummary;
  trace: RiskTrace;
  selectedTargets: readonly TargetTrace[];
};

const sortFactorByContribution = (left: RiskFactorTrace, right: RiskFactorTrace): number =>
  right.contribution - left.contribution || left.factorId.localeCompare(right.factorId);

const renderTargetText = (target: TargetTrace): string => {
  const lines: string[] = [];
  lines.push(`${target.targetType}: ${target.targetId}`);
  lines.push(`  score: ${target.totalScore} (${target.normalizedScore})`);
  lines.push("  top factors:");

  const topFactors = [...target.factors].sort(sortFactorByContribution).slice(0, 5);
  for (const factor of topFactors) {
    lines.push(
      `    - ${factor.factorId} | contribution=${factor.contribution} | confidence=${factor.confidence}`,
    );
  }

  lines.push("  reduction levers:");
  for (const lever of target.reductionLevers) {
    lines.push(`    - ${lever.factorId} | estimatedImpact=${lever.estimatedImpact}`);
  }

  return lines.join("\n");
};

const renderText = (payload: ExplainOutputPayload): string => {
  const lines: string[] = [];
  lines.push(`target: ${payload.summary.structural.targetPath}`);
  lines.push(`repositoryScore: ${payload.summary.risk.repositoryScore}`);
  lines.push(`selectedTargets: ${payload.selectedTargets.length}`);
  lines.push("");

  for (const target of payload.selectedTargets) {
    lines.push(renderTargetText(target));
    lines.push("");
  }

  return lines.join("\n").trimEnd();
};

const renderMarkdown = (payload: ExplainOutputPayload): string => {
  const lines: string[] = [];
  lines.push(`# CodeSentinel Explanation`);
  lines.push(`- target: \`${payload.summary.structural.targetPath}\``);
  lines.push(`- repositoryScore: \`${payload.summary.risk.repositoryScore}\``);
  lines.push(`- selectedTargets: \`${payload.selectedTargets.length}\``);
  lines.push("");

  for (const target of payload.selectedTargets) {
    lines.push(`## ${target.targetType}: \`${target.targetId}\``);
    lines.push(`- score: \`${target.totalScore}\` (\`${target.normalizedScore}\`)`);
    lines.push(`- dominantFactors: \`${target.dominantFactors.join(", ")}\``);
    lines.push(`- Top factors:`);
    for (const factor of [...target.factors].sort(sortFactorByContribution).slice(0, 5)) {
      lines.push(
        `  - \`${factor.factorId}\` contribution=\`${factor.contribution}\` confidence=\`${factor.confidence}\``,
      );
    }
    lines.push(`- Reduction levers:`);
    for (const lever of target.reductionLevers) {
      lines.push(`  - \`${lever.factorId}\` estimatedImpact=\`${lever.estimatedImpact}\``);
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
