import type { CodeSentinelReport } from "./domain.js";

const renderTextDiff = (report: CodeSentinelReport): string[] => {
  if (report.diff === undefined) {
    return [];
  }

  return [
    "",
    "Diff",
    `  riskScoreDelta: ${report.diff.riskScoreDelta}`,
    `  normalizedScoreDelta: ${report.diff.normalizedScoreDelta}`,
    `  newHotspots: ${report.diff.newHotspots.join(", ") || "none"}`,
    `  resolvedHotspots: ${report.diff.resolvedHotspots.join(", ") || "none"}`,
    `  newCycles: ${report.diff.newCycles.join(", ") || "none"}`,
    `  resolvedCycles: ${report.diff.resolvedCycles.join(", ") || "none"}`,
  ];
};

export const renderTextReport = (report: CodeSentinelReport): string => {
  const lines: string[] = [];
  lines.push("Repository Summary");
  lines.push(`  target: ${report.repository.targetPath}`);
  lines.push(`  riskScore: ${report.repository.riskScore}`);
  lines.push(`  normalizedScore: ${report.repository.normalizedScore}`);
  lines.push(`  riskTier: ${report.repository.riskTier}`);
  lines.push(`  healthTier: ${report.repository.healthTier}`);
  lines.push(`  confidence: ${report.repository.confidence ?? "n/a"}`);

  lines.push("");
  lines.push("Dimension Scores (0-100)");
  lines.push(`  structural: ${report.repository.dimensionScores.structural ?? "n/a"}`);
  lines.push(`  evolution: ${report.repository.dimensionScores.evolution ?? "n/a"}`);
  lines.push(`  external: ${report.repository.dimensionScores.external ?? "n/a"}`);
  lines.push(`  interactions: ${report.repository.dimensionScores.interactions ?? "n/a"}`);

  lines.push("");
  lines.push("Health Summary");
  lines.push(`  healthScore: ${report.health.healthScore}`);
  lines.push(`  normalizedScore: ${report.health.normalizedScore}`);
  lines.push(`  modularity: ${report.health.dimensions.modularity}`);
  lines.push(`  changeHygiene: ${report.health.dimensions.changeHygiene}`);
  lines.push(`  testHealth: ${report.health.dimensions.testHealth}`);
  lines.push(`  ownershipDistribution: ${report.health.dimensions.ownershipDistribution}`);
  lines.push("  topIssues:");
  for (const issue of report.health.topIssues.slice(0, 5)) {
    const ruleSuffix = issue.ruleId === undefined ? "" : ` [rule=${issue.ruleId}]`;
    lines.push(
      `    - [${issue.severity}] (${issue.dimension}) ${issue.id}${ruleSuffix} @ ${issue.target}: ${issue.message}`,
    );
  }
  if (report.health.topIssues.length === 0) {
    lines.push("    - none");
  }

  lines.push("");
  lines.push("Top Hotspots");
  for (const hotspot of report.hotspots) {
    lines.push(`  - ${hotspot.target} | score=${hotspot.score}`);
    for (const factor of hotspot.topFactors) {
      lines.push(
        `    factor: ${factor.label} contribution=${factor.contribution} confidence=${factor.confidence}`,
      );
      lines.push(`    evidence: ${factor.evidence}`);
    }
    lines.push(`    priority actions: ${hotspot.suggestedActions.join(" | ") || "none"}`);
  }

  lines.push("");
  lines.push("Structural Observations");
  lines.push(`  cycleCount: ${report.structural.cycleCount}`);
  lines.push(`  cycles: ${report.structural.cycles.join(" ; ") || "none"}`);
  lines.push(`  fragileClusters: ${report.structural.fragileClusters.length}`);

  lines.push("");
  lines.push("External Exposure");
  if (!report.external.available) {
    lines.push(`  unavailable: ${report.external.reason}`);
  } else {
    lines.push(
      `  highRiskDependencies: ${report.external.highRiskDependencies.join(", ") || "none"}`,
    );
    lines.push(
      `  highRiskDevelopmentDependencies: ${report.external.highRiskDevelopmentDependencies.join(", ") || "none"}`,
    );
    lines.push(
      `  singleMaintainerDependencies: ${report.external.singleMaintainerDependencies.join(", ") || "none"}`,
    );
    lines.push(
      `  abandonedDependencies: ${report.external.abandonedDependencies.join(", ") || "none"}`,
    );
  }

  lines.push("");
  lines.push("Appendix");
  lines.push(`  snapshotSchemaVersion: ${report.appendix.snapshotSchemaVersion}`);
  lines.push(`  riskModelVersion: ${report.appendix.riskModelVersion}`);
  lines.push(`  timestamp: ${report.appendix.timestamp}`);
  lines.push(`  normalization: ${report.appendix.normalization}`);

  lines.push(...renderTextDiff(report));

  return lines.join("\n");
};

const renderMarkdownDiff = (report: CodeSentinelReport): string[] => {
  if (report.diff === undefined) {
    return [];
  }

  return [
    "",
    "## Diff",
    `- riskScoreDelta: \`${report.diff.riskScoreDelta}\``,
    `- normalizedScoreDelta: \`${report.diff.normalizedScoreDelta}\``,
    `- newHotspots: ${report.diff.newHotspots.map((item) => `\`${item}\``).join(", ") || "none"}`,
    `- resolvedHotspots: ${report.diff.resolvedHotspots.map((item) => `\`${item}\``).join(", ") || "none"}`,
    `- newCycles: ${report.diff.newCycles.map((item) => `\`${item}\``).join(", ") || "none"}`,
    `- resolvedCycles: ${report.diff.resolvedCycles.map((item) => `\`${item}\``).join(", ") || "none"}`,
  ];
};

export const renderMarkdownReport = (report: CodeSentinelReport): string => {
  const lines: string[] = [];
  lines.push("# CodeSentinel Report");
  lines.push("");
  lines.push("## Repository Summary");
  lines.push(`- target: \`${report.repository.targetPath}\``);
  lines.push(`- riskScore: \`${report.repository.riskScore}\``);
  lines.push(`- normalizedScore: \`${report.repository.normalizedScore}\``);
  lines.push(`- riskTier: \`${report.repository.riskTier}\``);
  lines.push(`- healthTier: \`${report.repository.healthTier}\``);
  lines.push(`- confidence: \`${report.repository.confidence ?? "n/a"}\``);

  lines.push("");
  lines.push("## Dimension Scores (0-100)");
  lines.push(`- structural: \`${report.repository.dimensionScores.structural ?? "n/a"}\``);
  lines.push(`- evolution: \`${report.repository.dimensionScores.evolution ?? "n/a"}\``);
  lines.push(`- external: \`${report.repository.dimensionScores.external ?? "n/a"}\``);
  lines.push(`- interactions: \`${report.repository.dimensionScores.interactions ?? "n/a"}\``);

  lines.push("");
  lines.push("## Health Summary");
  lines.push(`- healthScore: \`${report.health.healthScore}\``);
  lines.push(`- normalizedScore: \`${report.health.normalizedScore}\``);
  lines.push(`- modularity: \`${report.health.dimensions.modularity}\``);
  lines.push(`- changeHygiene: \`${report.health.dimensions.changeHygiene}\``);
  lines.push(`- testHealth: \`${report.health.dimensions.testHealth}\``);
  lines.push(`- ownershipDistribution: \`${report.health.dimensions.ownershipDistribution}\``);
  if (report.health.topIssues.length === 0) {
    lines.push("- top issues: none");
  } else {
    lines.push("- top issues:");
    for (const issue of report.health.topIssues.slice(0, 5)) {
      const ruleSuffix = issue.ruleId === undefined ? "" : ` [rule=${issue.ruleId}]`;
      lines.push(
        `  - [${issue.severity}] \`${issue.id}\`${ruleSuffix} (\`${issue.dimension}\`) @ \`${issue.target}\`: ${issue.message}`,
      );
    }
  }

  lines.push("");
  lines.push("## Top Hotspots");
  for (const hotspot of report.hotspots) {
    lines.push(`- **${hotspot.target}** (score: \`${hotspot.score}\`)`);
    lines.push(`  - Top factors:`);
    for (const factor of hotspot.topFactors) {
      lines.push(
        `  - ${factor.label}: contribution=\`${factor.contribution}\`, confidence=\`${factor.confidence}\``,
      );
      lines.push(`  - evidence: \`${factor.evidence}\``);
    }
    lines.push(`  - Priority actions: ${hotspot.suggestedActions.join(" | ") || "none"}`);
  }

  lines.push("");
  lines.push("## Structural Observations");
  lines.push(`- cycles detected: \`${report.structural.cycleCount}\``);
  lines.push(
    `- cycles: ${report.structural.cycles.map((cycle) => `\`${cycle}\``).join(", ") || "none"}`,
  );
  lines.push(`- fragile clusters: \`${report.structural.fragileClusters.length}\``);

  lines.push("");
  lines.push("## External Exposure Summary");
  if (!report.external.available) {
    lines.push(`- unavailable: \`${report.external.reason}\``);
  } else {
    lines.push(
      `- high-risk dependencies: ${report.external.highRiskDependencies.map((item) => `\`${item}\``).join(", ") || "none"}`,
    );
    lines.push(
      `- high-risk development dependencies: ${report.external.highRiskDevelopmentDependencies.map((item) => `\`${item}\``).join(", ") || "none"}`,
    );
    lines.push(
      `- single maintainer dependencies: ${report.external.singleMaintainerDependencies.map((item) => `\`${item}\``).join(", ") || "none"}`,
    );
    lines.push(
      `- abandoned dependencies: ${report.external.abandonedDependencies.map((item) => `\`${item}\``).join(", ") || "none"}`,
    );
  }

  lines.push("");
  lines.push("## Appendix");
  lines.push(`- snapshot schema: \`${report.appendix.snapshotSchemaVersion}\``);
  lines.push(`- risk model version: \`${report.appendix.riskModelVersion}\``);
  lines.push(`- timestamp: \`${report.appendix.timestamp}\``);
  lines.push(`- normalization: ${report.appendix.normalization}`);

  lines.push(...renderMarkdownDiff(report));

  return lines.join("\n");
};
