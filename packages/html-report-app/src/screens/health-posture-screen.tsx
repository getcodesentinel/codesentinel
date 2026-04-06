import type { CodeSentinelReport, HealthIssue } from "@codesentinel/reporter";
import { formatScore, getHealthChipLabel } from "../app/report-data";
import { PageIntro } from "../components/design/page-intro";
import { MaterialSymbol } from "../components/material-symbol";
import { cn } from "../lib/utils";

type HealthPostureScreenProps = {
  report: CodeSentinelReport;
};

type HealthTraceDimension = NonNullable<
  CodeSentinelReport["health"]["trace"]
>["dimensions"][number];

type DimensionCardData = {
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

type PriorityIssueCard = {
  severity: string;
  severityClassName: string;
  icon: string;
  title: string;
  copy: string;
  tags: readonly string[];
  cta: string;
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

const presentDimensionLabel = (value: HealthIssue["dimension"]): string => {
  switch (value) {
    case "modularity":
      return "Architecture";
    case "changeHygiene":
      return "Change Hygiene";
    case "testHealth":
      return "Quality";
    case "ownershipDistribution":
      return "Ownership";
  }
};

const presentSeverity = (
  value: HealthIssue["severity"],
): { label: string; className: string; icon: string } => {
  if (value === "error") {
    return {
      label: "HIGH",
      className: "bg-error-container/20 text-error",
      icon: "warning",
    };
  }

  return {
    label: "MED",
    className: "bg-tertiary-container/20 text-on-tertiary-container",
    icon: "rule",
  };
};

const issueTitle = (issue: HealthIssue): string => {
  switch (issue.id) {
    case "health.modularity.cycle_density":
      return "Circular Dependency Pressure";
    case "health.modularity.centrality_concentration":
      return `Heavy Coupling in ${humanizePath(issue.target)}`;
    case "health.modularity.hotspot_overlap":
      return "Structural Hotspot Overlap";
    case "health.change_hygiene.churn_concentration":
      return `Churn Concentration in ${humanizePath(issue.target)}`;
    case "health.change_hygiene.volatility_concentration":
      return `Volatility Concentration in ${humanizePath(issue.target)}`;
    case "health.change_hygiene.dense_co_change_clusters":
      return "Dense Co-Change Cluster";
    case "health.test_health.low_test_presence":
      return "Low Test Presence";
    case "health.test_health.low_test_ratio":
      return "Test Coverage Gap";
    case "health.ownership.top_author_commit_share":
      return "Ownership Concentration";
    case "health.ownership.single_author_dominance":
      return "Single-Author Dominance";
    case "health.ownership.low_author_entropy":
      return "Low Ownership Diversity";
    default:
      return issue.id.replace(/^health\./, "").replaceAll(".", " ");
  }
};

const issueCta = (issue: HealthIssue): string => {
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

const issueTags = (issue: HealthIssue): readonly string[] => {
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

const issueIcon = (issue: HealthIssue): string => {
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

const topIssues = (report: CodeSentinelReport): readonly PriorityIssueCard[] =>
  report.health.topIssues.slice(0, 3).map((issue) => {
    const severity = presentSeverity(issue.severity);
    return {
      severity: severity.label,
      severityClassName: severity.className,
      icon: issueIcon(issue),
      title: issueTitle(issue),
      copy: issue.message,
      tags: issueTags(issue),
      cta: issueCta(issue),
    };
  });

const fallbackIssues = (): readonly PriorityIssueCard[] => [
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

const dimensionCards = (report: CodeSentinelReport): readonly DimensionCardData[] => {
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

const donutDashOffset = (score: number): number => {
  const circumference = 2 * Math.PI * 80;
  return circumference - (circumference * clampPercent(score)) / 100;
};

const trendChipLabel = (report: CodeSentinelReport): string => {
  if (report.diff === undefined) {
    return "Good (-)";
  }

  return `Good (${asSignedPoints(report.diff.normalizedScoreDelta * 100)} pts)`;
};

const heroDescription = (report: CodeSentinelReport): string => {
  const topIssue = report.health.topIssues[0];
  if (topIssue !== undefined) {
    return `${getHealthChipLabel(report.health.healthScore)}. The strongest pressure is currently in ${presentDimensionLabel(topIssue.dimension).toLowerCase()}, where ${topIssue.message.charAt(0).toLowerCase()}${topIssue.message.slice(1)}`;
  }

  return "Your repository maintains a stable health posture in this snapshot. Missing design metrics are shown as placeholders so the remaining data gaps are visible.";
};

const pageDescription =
  "A health posture view across modularity, change hygiene, test signals, and ownership distribution.";

export const HealthPostureScreen = ({ report }: HealthPostureScreenProps) => {
  const issues = topIssues(report);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 p-4 md:p-8">
      <PageIntro
        description={pageDescription}
        label="Repository Health"
        labelClassName="text-tertiary"
        title="Health Posture"
      />

      <section className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
        <div className="self-start flex flex-col items-center rounded-xl bg-surface-container-lowest p-8 text-center lg:col-span-4">
          <p className="mb-6 text-[0.6875rem] font-bold uppercase tracking-widest text-on-surface-variant">
            Overall Health Score
          </p>
          <div className="relative flex h-48 w-48 items-center justify-center">
            <svg className="h-full w-full -rotate-90" viewBox="0 0 192 192">
              <circle
                className="text-surface-container-low"
                cx="96"
                cy="96"
                fill="transparent"
                r="80"
                stroke="currentColor"
                strokeWidth="12"
              />
              <circle
                className="text-tertiary-fixed transition-all duration-1000"
                cx="96"
                cy="96"
                fill="transparent"
                r="80"
                stroke="currentColor"
                strokeDasharray={2 * Math.PI * 80}
                strokeDashoffset={donutDashOffset(report.health.healthScore)}
                strokeLinecap="round"
                strokeWidth="12"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[3.5rem] font-semibold tracking-tight text-on-surface">
                {formatScore(report.health.healthScore)}
              </span>
              <span className="text-sm font-medium text-on-surface-variant">/ 100</span>
            </div>
          </div>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-tertiary-container/10 px-3 py-1 text-xs font-semibold text-tertiary-fixed">
            <MaterialSymbol className="text-sm" icon="trending_up" />
            {trendChipLabel(report)}
          </div>
          <p className="mt-6 px-4 text-sm leading-relaxed text-on-surface-variant">
            {heroDescription(report)}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:col-span-8">
          {dimensionCards(report).map((card) => (
            <div
              className={cn(
                "rounded-xl border-l-4 bg-surface-container-low p-6",
                card.accentClassName,
              )}
              key={card.title}
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-container-lowest">
                  <MaterialSymbol
                    className={cn("text-[20px]", card.iconClassName)}
                    icon={card.icon}
                  />
                </div>
                <span className="text-xs font-bold text-on-surface-variant">
                  {card.metricLabel}: <span className="text-on-surface">{card.metricValue}</span>
                </span>
              </div>
              <h3 className="mb-1 text-[1.125rem] font-semibold text-on-surface">{card.title}</h3>
              <p className="mb-4 text-xs text-on-surface-variant">{card.description}</p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-lowest">
                {card.meterPercent > 0 ? (
                  <div
                    className={cn("h-full rounded-full", card.barClassName)}
                    style={{ width: `${card.meterPercent}%` }}
                  />
                ) : null}
              </div>
              <p className={cn("mt-3 text-xs font-medium", card.statusClassName)}>{card.status}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-6">
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-on-surface">
              Top Health Issues &amp; Action Plan
            </h2>
            <div className="rounded bg-tertiary-fixed/10 px-2 py-1 text-xs font-bold text-tertiary-fixed">
              {issues.length} Priority Actions
            </div>
          </div>

          <div className="space-y-4">
            {(issues.length > 0 ? issues : fallbackIssues()).map((issue) => (
              <div
                className="group rounded-xl bg-surface-container-lowest p-6 transition-shadow hover:shadow-md"
                key={`${issue.title}-${issue.copy}`}
              >
                <div className="flex gap-6">
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        "mb-2 rounded-full px-2 py-0.5 text-[0.6875rem] font-bold",
                        issue.severityClassName,
                      )}
                    >
                      {issue.severity}
                    </span>
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-container-low">
                      <MaterialSymbol className="text-on-surface-variant" icon={issue.icon} />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="mb-1 font-semibold text-on-surface">{issue.title}</h4>
                    <p className="mb-4 text-sm text-on-surface-variant">{issue.copy}</p>
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="flex gap-2">
                        {issue.tags.map((tag) => (
                          <span
                            className="rounded bg-surface-container-low px-2 py-1 text-[0.625rem] font-bold uppercase text-on-surface"
                            key={tag}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <button
                        className="hidden items-center gap-1 text-xs font-semibold text-tertiary transition-all group-hover:gap-2"
                        tabIndex={-1}
                        type="button"
                      >
                        {issue.cta}
                        <MaterialSymbol className="text-sm" icon="arrow_forward" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
};
