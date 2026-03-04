import { factorLabel, summarizeEvidence, type CodeSentinelSnapshot } from "@codesentinel/reporter";
import type { GateEvaluationResult, Violation } from "./domain.js";

const renderViolationText = (violation: Violation): string => {
  const targets = violation.targets.join(", ") || "n/a";
  return `- [${violation.severity}] ${violation.id}: ${violation.message} (targets: ${targets})`;
};

export const renderCheckText = (
  snapshot: CodeSentinelSnapshot,
  result: GateEvaluationResult,
): string => {
  const lines: string[] = [];
  lines.push("CodeSentinel Check");
  lines.push(`target: ${snapshot.analysis.structural.targetPath}`);
  lines.push(`riskScore: ${snapshot.analysis.risk.riskScore}`);
  lines.push(`evaluatedGates: ${result.evaluatedGates.join(", ") || "none"}`);
  lines.push(`violations: ${result.violations.length}`);
  lines.push(`exitCode: ${result.exitCode}`);
  lines.push("");
  lines.push("Violations");
  if (result.violations.length === 0) {
    lines.push("- none");
  } else {
    for (const violation of result.violations) {
      lines.push(renderViolationText(violation));
    }
  }

  return lines.join("\n");
};

export const renderCheckMarkdown = (
  snapshot: CodeSentinelSnapshot,
  result: GateEvaluationResult,
): string => {
  const lines: string[] = [];
  lines.push("## CodeSentinel CI Summary");
  lines.push(`- target: \`${snapshot.analysis.structural.targetPath}\``);
  lines.push(`- riskScore: \`${snapshot.analysis.risk.riskScore}\``);
  lines.push(
    `- evaluatedGates: ${result.evaluatedGates.map((item) => `\`${item}\``).join(", ") || "none"}`,
  );
  lines.push(`- violations: \`${result.violations.length}\``);
  lines.push(`- exitCode: \`${result.exitCode}\``);

  const repositoryTrace = snapshot.trace?.targets.find(
    (target) =>
      target.targetType === "repository" &&
      target.targetId === snapshot.analysis.structural.targetPath,
  );
  if (repositoryTrace !== undefined) {
    lines.push("");
    lines.push("### Why");
    const topFactors = [...repositoryTrace.factors]
      .sort((a, b) => b.contribution - a.contribution || a.factorId.localeCompare(b.factorId))
      .slice(0, 3);

    for (const factor of topFactors) {
      lines.push(
        `- ${factorLabel(factor.factorId)}: contribution=\`${factor.contribution}\`, evidence=\`${summarizeEvidence(factor)}\``,
      );
    }
  }

  lines.push("");
  lines.push("### Violations");
  if (result.violations.length === 0) {
    lines.push("- none");
  } else {
    for (const violation of result.violations) {
      lines.push(`- [${violation.severity}] **${violation.id}**: ${violation.message}`);
      if (violation.targets.length > 0) {
        lines.push(`  - targets: ${violation.targets.map((target) => `\`${target}\``).join(", ")}`);
      }
    }
  }

  return lines.join("\n");
};
