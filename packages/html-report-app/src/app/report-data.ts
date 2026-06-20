import type { CodeSentinelReport, HealthIssue, RiskTier } from "@codesentinel/reporter";

declare global {
  interface Window {
    __CODESENTINEL_REPORT__?: CodeSentinelReport;
  }
}

export type ScreenId =
  | "executive-overview"
  | "risk-drivers"
  | "hotspots"
  | "architecture"
  | "change-ownership"
  | "dependency-pressure"
  | "health-posture"
  | "compare";

export type ScreenDefinition = {
  id: ScreenId;
  label: string;
  icon: string;
  visible?: boolean;
};

export const screens: readonly ScreenDefinition[] = [
  { id: "executive-overview", label: "Executive Overview", icon: "dashboard" },
  { id: "risk-drivers", label: "Risk Drivers", icon: "security" },
  { id: "hotspots", label: "Hotspots", icon: "local_fire_department" },
  { id: "architecture", label: "Architecture", icon: "account_tree" },
  { id: "change-ownership", label: "Change & Ownership", icon: "history" },
  { id: "dependency-pressure", label: "Dependency Pressure", icon: "layers" },
  { id: "health-posture", label: "Health Posture", icon: "health_and_safety" },
  { id: "compare", label: "Compare", icon: "compare_arrows", visible: false },
];

export const getReport = (): CodeSentinelReport | undefined => window.__CODESENTINEL_REPORT__;

export const formatTimestamp = (value: string): string =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export const formatScore = (value: number | null | undefined): string =>
  value === null || value === undefined ? "n/a" : value.toFixed(value % 1 === 0 ? 0 : 1);

export const getRiskChipLabel = (tier: RiskTier): string => {
  switch (tier) {
    case "very_high":
      return "Very High";
    case "high":
      return "High";
    case "elevated":
      return "Medium-High";
    case "moderate":
      return "Moderate";
    case "low":
      return "Low";
  }
};

export const getRiskTone = (
  tier: RiskTier,
): {
  chipClassName: string;
  iconClassName: string;
  meterClassName: string;
  emphasisClassName: string;
} => {
  switch (tier) {
    case "low":
      return {
        chipClassName:
          "inline-flex items-center rounded-full bg-surface-container px-2.5 py-0.5 text-xs font-bold text-on-surface-variant",
        iconClassName: "text-on-surface-variant",
        meterClassName: "bg-primary/35",
        emphasisClassName: "text-on-surface",
      };
    case "moderate":
      return {
        chipClassName:
          "inline-flex items-center rounded-full bg-surface-container-high px-2.5 py-0.5 text-xs font-bold text-on-surface",
        iconClassName: "text-primary",
        meterClassName: "bg-primary/70",
        emphasisClassName: "text-on-surface",
      };
    case "elevated":
    case "high":
    case "very_high":
      return {
        chipClassName:
          "inline-flex items-center rounded-full bg-error-container/20 px-2.5 py-0.5 text-xs font-bold text-on-error-container",
        iconClassName: "text-error",
        meterClassName: "bg-error",
        emphasisClassName: "text-on-error-container",
      };
  }
};

export const getHealthChipLabel = (score: number): string => {
  if (score >= 80) {
    return "Strong Posture";
  }
  if (score >= 60) {
    return "Healthy Posture";
  }
  if (score >= 40) {
    return "Watch Posture";
  }
  return "Weak Posture";
};

export const getHealthTone = (
  score: number,
): {
  chipClassName: string;
  iconClassName: string;
  meterClassName: string;
  accentBorderClassName: string;
} => {
  if (score >= 80) {
    return {
      chipClassName:
        "inline-flex items-center rounded-full bg-tertiary-container/20 px-2.5 py-0.5 text-xs font-bold text-tertiary",
      iconClassName: "text-tertiary",
      meterClassName: "bg-tertiary",
      accentBorderClassName: "border-tertiary",
    };
  }

  if (score >= 60) {
    return {
      chipClassName:
        "inline-flex items-center rounded-full bg-tertiary-container/10 px-2.5 py-0.5 text-xs font-bold text-tertiary",
      iconClassName: "text-tertiary/85",
      meterClassName: "bg-tertiary/75",
      accentBorderClassName: "border-tertiary/60",
    };
  }

  if (score >= 40) {
    return {
      chipClassName:
        "inline-flex items-center rounded-full bg-surface-container px-2.5 py-0.5 text-xs font-bold text-on-surface-variant",
      iconClassName: "text-on-surface-variant",
      meterClassName: "bg-primary/40",
      accentBorderClassName: "border-outline-variant/40",
    };
  }

  return {
    chipClassName:
      "inline-flex items-center rounded-full bg-error-container/12 px-2.5 py-0.5 text-xs font-bold text-on-error-container",
    iconClassName: "text-error/80",
    meterClassName: "bg-error/70",
    accentBorderClassName: "border-error/45",
  };
};

export const getDimensionLevel = (value: number | null | undefined): string => {
  if (value === null || value === undefined) {
    return "Unknown";
  }
  if (value >= 70) {
    return "Critical";
  }
  if (value >= 45) {
    return "Moderate";
  }
  return "Low";
};

type HealthTraceDimension = NonNullable<
  CodeSentinelReport["health"]["trace"]
>["dimensions"][number];

export type HealthDimensionCardData = {
  title: string;
  description: string;
  icon: string;
  metricLabel: string;
  metricValue: string;
  meterPercent: number;
  barClassName: string;
  iconClassName: string;
  accentClassName: string;
  status: string;
  statusClassName: string;
};

export type HealthPriorityIssueCard = {
  severity: string;
  severityClassName: string;
  icon: string;
  title: string;
  copy: string;
  tags: readonly string[];
  cta: string;
};

export type ExecutiveCriticalIssue = {
  tag: string;
  title: string;
  copy: string;
  info: string;
};

export type HealthPostureViewModel = {
  dimensionCards: readonly HealthDimensionCardData[];
  priorityIssues: readonly HealthPriorityIssueCard[];
  fallbackIssues: readonly HealthPriorityIssueCard[];
  heroDescription: string;
  trendChipLabel: string;
};

const clampPercent = (value: number | null | undefined): number =>
  Math.max(0, Math.min(100, Math.round(value ?? 0)));

const asRatioString = (value: number | null | undefined): string =>
  value === null || value === undefined ? "-" : value.toFixed(2);

const ratioToPercent = (value: number | null | undefined): number =>
  value === null || value === undefined ? 0 : clampPercent(value * 100);

const asSignedPoints = (value: number | null | undefined): string => {
  if (value === null || value === undefined) {
    return "-";
  }

  if (value === 0) {
    return "0";
  }

  return `${value > 0 ? "+" : ""}${formatScore(value)}`;
};

const findDimensionTrace = (
  report: CodeSentinelReport,
  dimension: HealthTraceDimension["dimension"],
): HealthTraceDimension | undefined =>
  report.health.trace?.dimensions.find((entry) => entry.dimension === dimension);

const findRawMetric = (
  trace: HealthTraceDimension | undefined,
  factorId: string,
  metric: string,
): number | null => {
  const factor = trace?.factors.find((entry) => entry.factorId === factorId);
  return factor?.rawMetrics[metric] ?? null;
};

const humanizePath = (value: string): string =>
  value.split("/").filter(Boolean).slice(-2).join(" / ") || value;

const humanizeMetricId = (value: string): string =>
  value
    .replace(/^health\./, "")
    .split(".")
    .pop()
    ?.replaceAll("_", " ")
    .replace(/\b\w/g, (segment) => segment.toUpperCase()) ?? value;

export const presentHealthDimension = (
  dimension: HealthIssue["dimension"],
  mode: "short" | "full" = "full",
): string => {
  switch (dimension) {
    case "modularity":
      return "Architecture";
    case "changeHygiene":
      return mode === "short" ? "Change" : "Change Hygiene";
    case "testHealth":
      return mode === "short" ? "Quality" : "Quality";
    case "ownershipDistribution":
      return "Ownership";
  }
};

export const presentHealthIssueTitle = (
  issue: HealthIssue,
  mode: "executive" | "health-posture" = "executive",
): string => {
  switch (issue.id) {
    case "health.modularity.cycle_density":
    case "health.modularity.cycle_overlap":
      return "Circular Dependency Pressure";
    case "health.modularity.centrality_concentration":
      return `Heavy Coupling in ${humanizePath(issue.target)}`;
    case "health.modularity.hotspot_overlap":
      return "Structural Hotspot Overlap";
    case "health.change.high_hotspot_overlap":
      return "Hotspot Overlap Pressure";
    case "health.change_hygiene.churn_concentration":
      return `Churn Concentration in ${humanizePath(issue.target)}`;
    case "health.change_hygiene.volatility_concentration":
      return `Volatility Concentration in ${humanizePath(issue.target)}`;
    case "health.change_hygiene.dense_co_change_clusters":
      return "Dense Co-Change Cluster";
    case "health.change.high_recent_volatility":
      return "Volatile Change Window";
    case "health.test_health.low_test_presence":
    case "health.test.low_test_presence":
      return "Low Test Presence";
    case "health.test_health.low_test_ratio":
      return "Test Coverage Gap";
    case "health.ownership.top_author_commit_share":
      return "Ownership Concentration";
    case "health.ownership.single_author_dominance":
      return "Single-Author Dominance";
    case "health.ownership.low_author_entropy":
      return mode === "health-posture" ? "Low Ownership Diversity" : "Narrow Ownership Spread";
    default:
      return humanizeMetricId(issue.id);
  }
};

const presentHealthSeverity = (
  value: HealthIssue["severity"],
): { label: string; className: string } => {
  if (value === "error") {
    return {
      label: "HIGH",
      className: "bg-error-container/20 text-error",
    };
  }

  return {
    label: "MED",
    className: "bg-tertiary-container/20 text-on-tertiary-container",
  };
};

const healthIssueCta = (issue: HealthIssue): string => {
  switch (issue.dimension) {
    case "modularity":
      return "View Refactor Guide";
    case "changeHygiene":
      return "Review Hotspots";
    case "testHealth":
      return "Assign Tickets";
    case "ownershipDistribution":
      return "Schedule Review";
  }
};

const healthIssueTags = (issue: HealthIssue): readonly string[] => {
  switch (issue.dimension) {
    case "modularity":
      return ["Refactor", "Architecture"];
    case "changeHygiene":
      return ["Churn", "Coordination"];
    case "testHealth":
      return ["Quality", "Technical Debt"];
    case "ownershipDistribution":
      return ["Ownership", "Risk Mitigation"];
  }
};

const healthIssueIcon = (issue: HealthIssue): string => {
  switch (issue.dimension) {
    case "modularity":
      return "hub";
    case "changeHygiene":
      return "swap_horiz";
    case "testHealth":
      return "biotech";
    case "ownershipDistribution":
      return "person_off";
  }
};

const createPriorityIssueCards = (report: CodeSentinelReport): readonly HealthPriorityIssueCard[] =>
  report.health.topIssues.slice(0, 3).map((issue) => {
    const severity = presentHealthSeverity(issue.severity);
    return {
      severity: severity.label,
      severityClassName: severity.className,
      icon: healthIssueIcon(issue),
      title: presentHealthIssueTitle(issue, "health-posture"),
      copy: issue.message,
      tags: healthIssueTags(issue),
      cta: healthIssueCta(issue),
    };
  });

const createFallbackIssueCards = (): readonly HealthPriorityIssueCard[] => [
  {
    severity: "LOW",
    severityClassName: "bg-surface-container-low text-on-surface-variant",
    icon: "check_circle",
    title: "No priority issues detected",
    copy: "This snapshot did not surface any health issues in the current report payload.",
    tags: ["Snapshot", "Health"],
    cta: "Review Full Report",
  },
];

const createDimensionCards = (report: CodeSentinelReport): readonly HealthDimensionCardData[] => {
  const modularityTrace = findDimensionTrace(report, "modularity");
  const testTrace = findDimensionTrace(report, "testHealth");
  const ownershipTrace = findDimensionTrace(report, "ownershipDistribution");

  const modularityIndex = findRawMetric(
    modularityTrace,
    "health.modularity.centrality_concentration",
    "centralityConcentration",
  );
  const cycleCount = findRawMetric(
    modularityTrace,
    "health.modularity.cycle_density",
    "cycleCount",
  );
  const testRatio = findRawMetric(
    testTrace,
    "health.test_health.test_to_source_ratio",
    "testToSourceRatio",
  );
  const testFiles = findRawMetric(testTrace, "health.test_health.test_file_presence", "testFiles");
  const authorEntropy = findRawMetric(
    ownershipTrace,
    "health.ownership.author_entropy",
    "authorEntropy",
  );
  const moduleDominance = findRawMetric(
    ownershipTrace,
    "health.ownership.module_single_author_dominance",
    "modulesDominatedBySingleContributorRatio",
  );
  const churnShare = findRawMetric(
    findDimensionTrace(report, "changeHygiene"),
    "health.change_hygiene.churn_concentration",
    "top10PercentFilesChurnShare",
  );
  const volatilityShare = findRawMetric(
    findDimensionTrace(report, "changeHygiene"),
    "health.change_hygiene.volatility_concentration",
    "top10PercentFilesVolatilityShare",
  );
  const coChangeDensity = findRawMetric(
    findDimensionTrace(report, "changeHygiene"),
    "health.change_hygiene.dense_co_change_clusters",
    "denseCoChangePairRatio",
  );

  return [
    {
      title: "Modularity",
      description: "Code coupling and package boundaries.",
      icon: "grid_view",
      metricLabel: "INDEX",
      metricValue: asRatioString(modularityIndex),
      meterPercent: ratioToPercent(modularityIndex),
      barClassName: "bg-tertiary",
      iconClassName: "text-tertiary",
      accentClassName: "border-tertiary-fixed",
      status:
        cycleCount === null
          ? "Cycle data unavailable"
          : `${Math.round(cycleCount)} cycle${cycleCount === 1 ? "" : "s"} detected`,
      statusClassName: "text-tertiary-fixed",
    },
    {
      title: "Change Hygiene",
      description: "How concentrated recent change pressure is.",
      icon: "clean_hands",
      metricLabel: "HOTSPOT CHURN SHARE",
      metricValue: churnShare === null ? "-" : `${Math.round(churnShare * 100)}%`,
      meterPercent:
        churnShare === null
          ? clampPercent(report.health.dimensions.changeHygiene)
          : ratioToPercent(churnShare),
      barClassName: "bg-tertiary-container",
      iconClassName: "text-tertiary-container",
      accentClassName: "border-tertiary-container",
      status:
        churnShare === null
          ? "Trace unavailable"
          : churnShare >= 0.65
            ? "Needs Attention: churn is concentrated"
            : volatilityShare !== null && volatilityShare >= 0.65
              ? "Elevated: volatility is clustering"
              : coChangeDensity !== null && coChangeDensity >= 0.12
                ? "Watch: dense co-change detected"
                : "Healthy: change pressure is distributed",
      statusClassName: "text-tertiary-container",
    },
    {
      title: "Test Health",
      description: "Repository test presence and structural test ratio.",
      icon: "biotech",
      metricLabel: "TEST RATIO",
      metricValue: testRatio === null ? "-" : `${Math.round(testRatio * 100)}%`,
      meterPercent: ratioToPercent(testRatio),
      barClassName: "bg-tertiary-fixed",
      iconClassName: "text-tertiary-fixed",
      accentClassName: "border-tertiary-fixed",
      status:
        testFiles === null ? "No trace available" : `${Math.round(testFiles)} test files detected`,
      statusClassName: "text-tertiary-fixed",
    },
    {
      title: "Ownership Distribution",
      description: "Knowledge silos and contributor concentration.",
      icon: "groups",
      metricLabel: "ENTROPY",
      metricValue: asRatioString(authorEntropy),
      meterPercent: ratioToPercent(authorEntropy),
      barClassName: "bg-secondary",
      iconClassName: "text-secondary",
      accentClassName: "border-secondary",
      status:
        moduleDominance === null
          ? "Ownership detail unavailable"
          : `${Math.round(moduleDominance * 100)}% dominated modules`,
      statusClassName: "text-secondary",
    },
  ];
};

const createHealthTrendChipLabel = (report: CodeSentinelReport): string => {
  if (report.diff === undefined) {
    return "Good (-)";
  }

  return `Good (${asSignedPoints(report.diff.normalizedScoreDelta * 100)} pts)`;
};

const createHealthHeroDescription = (report: CodeSentinelReport): string => {
  const topIssue = report.health.topIssues[0];
  if (topIssue !== undefined) {
    return `${getHealthChipLabel(report.health.healthScore)}. The strongest pressure is currently in ${presentHealthDimension(topIssue.dimension).toLowerCase()}, where ${topIssue.message.charAt(0).toLowerCase()}${topIssue.message.slice(1)}`;
  }

  return "Your repository maintains a stable health posture in this snapshot. Missing design metrics are shown as placeholders so the remaining data gaps are visible.";
};

export const createHealthPostureViewModel = (
  report: CodeSentinelReport,
): HealthPostureViewModel => ({
  dimensionCards: createDimensionCards(report),
  priorityIssues: createPriorityIssueCards(report),
  fallbackIssues: createFallbackIssueCards(),
  heroDescription: createHealthHeroDescription(report),
  trendChipLabel: createHealthTrendChipLabel(report),
});

export const createExecutiveCriticalIssues = (
  report: CodeSentinelReport,
): readonly ExecutiveCriticalIssue[] =>
  report.health.topIssues.slice(0, 3).map((issue) => ({
    tag: presentHealthDimension(issue.dimension, "short"),
    title: presentHealthIssueTitle(issue),
    copy: issue.message,
    info: issue.ruleId === undefined ? issue.signal : issue.ruleId,
  }));

export const downloadReportJson = (report: CodeSentinelReport): void => {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${report.repository.name || "codesentinel-report"}.report.json`;
  anchor.click();
  URL.revokeObjectURL(url);
};
