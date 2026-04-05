import type { CodeSentinelReport } from "@codesentinel/reporter";
import type { HealthIssue } from "@codesentinel/reporter";
import {
  formatScore,
  getDimensionLevel,
  getHealthChipLabel,
  getRiskChipLabel,
} from "../app/report-data";
import { QuietAction } from "../components/design/actions";
import { IssueCard } from "../components/design/issue-card";
import { SurfaceCard, SurfaceInset, SurfacePanel } from "../components/design/surfaces";
import {
  BodyMd,
  BodySm,
  LabelSm,
  MetaLabel,
  MetricUnit,
  MetricValue,
  SectionHeading,
} from "../components/design/typography";
import { MaterialSymbol } from "../components/material-symbol";

const dependencyMapImage =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuCJigVZgnvdShuL8jTrcBixUhdfhUho12np-HxRvjubWPuJadXUCjU45Ynm9JQ-Dx9Re9rCa9fZY7S2tUIts_ef4jOVEWJMwm92YJGYKYjUEr2sjtJCBjEnHvrYtY7yllk09WElGK68DF4tgV8n1b1DeoPexRqHVquOujwG8IPWRuL9phHFKQwrqdrun4q1Vfn3lVgHG3bUEkaZTuvuWOCq2tigZmb8bPUiYWhXJhnJvXMLFRlDzbp60axW2CMG-0AfA7VP3Rr8CiQ";

type ExecutiveOverviewScreenProps = {
  report: CodeSentinelReport;
};

const getCurrentFocus = (report: CodeSentinelReport): string =>
  report.repository.name ||
  report.repository.targetPath.split("/").filter(Boolean).pop() ||
  "repository";

const getHeroSummary = (report: CodeSentinelReport): string => {
  const firstHotspot = report.hotspots[0];
  if (firstHotspot !== undefined) {
    return `Fragility is increasing around ${firstHotspot.module} due to sustained hotspot pressure and concentrated change activity.`;
  }

  return "Fragility is increasing due to deep dependency chains and high churn in core modules.";
};

const getRiskTrendText = (report: CodeSentinelReport): string => {
  if (report.diff !== undefined && report.diff.riskScoreDelta !== 0) {
    const delta = Math.abs(report.diff.riskScoreDelta).toFixed(1);
    return report.diff.riskScoreDelta > 0
      ? `Risk increased +${delta} since baseline`
      : `Risk improved -${delta} since baseline`;
  }

  return `${report.hotspots.length} hotspots require review`;
};

const getImmediateHotspot = (report: CodeSentinelReport) => report.hotspots[0];

const getDimensionToneClassName = (value: number | null | undefined): string => {
  const level = getDimensionLevel(value);
  if (level === "Critical" || level === "High") {
    return "text-error";
  }

  return "text-on-surface-variant";
};

const presentHealthDimension = (dimension: HealthIssue["dimension"]): string => {
  switch (dimension) {
    case "modularity":
      return "Architecture";
    case "changeHygiene":
      return "Change";
    case "testHealth":
      return "Quality";
    case "ownershipDistribution":
      return "Ownership";
  }
};

const humanizeMetricId = (value: string): string =>
  value
    .replace(/^health\./, "")
    .split(".")
    .pop()
    ?.replaceAll("_", " ")
    .replace(/\b\w/g, (segment) => segment.toUpperCase()) ?? value;

const presentIssueTitle = (issue: HealthIssue): string => {
  switch (issue.id) {
    case "health.ownership.top_author_commit_share":
      return "Ownership Concentration";
    case "health.ownership.single_author_dominance":
      return "Single-Author Dominance";
    case "health.ownership.low_author_entropy":
      return "Narrow Ownership Spread";
    case "health.change.high_recent_volatility":
      return "Volatile Change Window";
    case "health.change.high_hotspot_overlap":
      return "Hotspot Overlap Pressure";
    case "health.test.low_test_presence":
      return "Low Test Presence";
    case "health.modularity.cycle_overlap":
      return "Circular Dependency Pressure";
    default:
      return humanizeMetricId(issue.id);
  }
};

const getCriticalIssues = (report: CodeSentinelReport) =>
  report.health.topIssues.slice(0, 3).map((issue) => ({
    tag: presentHealthDimension(issue.dimension),
    title: presentIssueTitle(issue),
    copy: issue.message,
    info: issue.ruleId === undefined ? issue.signal : issue.ruleId,
  }));

const hotspotNarrative = (report: CodeSentinelReport): string => {
  const hotspot = report.hotspots[0];
  if (hotspot === undefined) {
    return "No hotspot narrative is available for this report.";
  }

  if (hotspot.target.includes("session")) {
    return 'The session management logic is becoming a "God Class". Multiple teams are patching it simultaneously, creating a high risk of regression.';
  }

  return `${hotspot.target} is becoming a central pressure point. Multiple contributors are likely converging here, increasing regression risk and review load.`;
};

const hotspotFindingCopy = (report: CodeSentinelReport): readonly string[] => {
  const hotspot = report.hotspots[0];
  if (hotspot === undefined || hotspot.topFactors.length === 0) {
    return ["No top factor evidence available in this snapshot."];
  }

  return hotspot.topFactors.slice(0, 2).map((factor) => {
    if (factor.label === "File structural complexity") {
      return `Increased Cyclomatic Complexity (+${Math.round(factor.contribution)})`;
    }
    if (factor.label === "File interaction amplification") {
      return `File interaction amplification (${formatScore(factor.contribution)})`;
    }
    if (factor.label === "File change volatility") {
      return `Sustained change volatility (${formatScore(factor.contribution)})`;
    }
    return `${factor.label} (${formatScore(factor.contribution)})`;
  });
};

export const ExecutiveOverviewScreen = ({ report }: ExecutiveOverviewScreenProps) => {
  const focus = getCurrentFocus(report);
  const hotspot = getImmediateHotspot(report);
  const criticalIssues = getCriticalIssues(report);
  const hotspotFindings = hotspotFindingCopy(report);

  return (
    <main className="max-w-7xl p-8">
      <section className="mb-12">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <LabelSm as="h3" className="mb-1 tracking-[0.1em]">
              Current Focus
            </LabelSm>
            <h2 className="text-3xl font-semibold tracking-tight text-on-surface">{focus}</h2>
            <BodyMd className="mt-2 max-w-2xl">{getHeroSummary(report)}</BodyMd>
          </div>
          <div className="flex gap-4">
            <div className="flex items-center gap-2 rounded-full border border-outline-variant/10 bg-surface-container-low px-4 py-2">
              <MaterialSymbol className="text-[18px] text-error" icon="trending_up" />
              <span className="text-xs font-bold text-on-surface">{getRiskTrendText(report)}</span>
            </div>
          </div>
        </div>
      </section>

      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-12">
        <SurfaceCard className="md:col-span-4 flex flex-col justify-between p-8">
          <div>
            <div className="mb-4 flex items-start justify-between">
              <LabelSm as="span" className="tracking-widest">
                Risk Score
              </LabelSm>
              <MaterialSymbol className="text-error" icon="warning" />
            </div>
            <div className="flex items-baseline gap-2">
              <MetricValue as="span" className="text-6xl font-bold tracking-tighter">
                {formatScore(report.repository.riskScore)}
              </MetricValue>
              <MetricUnit as="span">/ 100</MetricUnit>
            </div>
            <div className="ds-chip-risk mt-4">{getRiskChipLabel(report.repository.riskTier)}</div>
          </div>
          <div className="mt-8">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
              <div
                className="h-full rounded-full bg-error"
                style={{ width: `${Math.max(0, Math.min(100, report.repository.riskScore))}%` }}
              />
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard className="md:col-span-4 flex flex-col justify-between border-l-4 border-tertiary p-8">
          <div>
            <div className="mb-4 flex items-start justify-between">
              <LabelSm as="span" className="tracking-widest">
                Health Posture
              </LabelSm>
              <MaterialSymbol className="text-tertiary" icon="verified_user" />
            </div>
            <div className="flex items-baseline gap-2">
              <MetricValue as="span" className="text-6xl font-bold tracking-tighter">
                {formatScore(report.health.healthScore)}
              </MetricValue>
              <MetricUnit as="span">/ 100</MetricUnit>
            </div>
            <div className="ds-chip-health mt-4">
              {getHealthChipLabel(report.health.healthScore)}
            </div>
          </div>
          <div className="mt-8">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
              <div
                className="h-full rounded-full bg-tertiary"
                style={{ width: `${Math.max(0, Math.min(100, report.health.healthScore))}%` }}
              />
            </div>
          </div>
        </SurfaceCard>

        <SurfacePanel className="md:col-span-4 space-y-6 p-8">
          <LabelSm as="h4" className="tracking-widest">
            Core Dimensions
          </LabelSm>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-on-surface">Structural Integrity</span>
              <span
                className={`text-xs font-bold ${getDimensionToneClassName(report.repository.dimensionScores.structural)}`}
              >
                {getDimensionLevel(report.repository.dimensionScores.structural)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-on-surface">Change Velocity</span>
              <span
                className={`text-xs font-bold ${getDimensionToneClassName(report.repository.dimensionScores.evolution)}`}
              >
                {getDimensionLevel(report.repository.dimensionScores.evolution)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-on-surface">Dependency Depth</span>
              <span
                className={`text-xs font-bold ${getDimensionToneClassName(report.repository.dimensionScores.external)}`}
              >
                {getDimensionLevel(report.repository.dimensionScores.external)}
              </span>
            </div>
          </div>
          <div className="border-t border-outline-variant/20 pt-4">
            <p className="text-xs italic leading-snug text-on-surface-variant">
              "
              {hotspot === undefined
                ? "Architectural debt is mounting in the core API gateway."
                : hotspot.reason}
              "
            </p>
          </div>
        </SurfacePanel>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <SectionHeading as="h3" className="flex items-center gap-2">
              <MaterialSymbol icon="priority_high" />
              Immediate Attention Required
            </SectionHeading>
          </div>

          <SurfaceCard className="overflow-hidden shadow-sm">
            <div className="flex items-center justify-between border-b border-surface-container-low p-6">
              <div className="flex items-center gap-4">
                <div className="rounded-lg bg-error-container/10 p-3">
                  <MaterialSymbol className="text-error" icon="bolt" />
                </div>
                <div>
                  <SectionHeading as="h4" className="text-[0.95rem] font-normal">
                    {hotspot === undefined
                      ? "Unstable Hotspot: unavailable"
                      : `Unstable Hotspot: ${hotspot.target}`}
                  </SectionHeading>
                  <BodySm className="text-xs leading-normal">
                    {hotspot === undefined
                      ? "No hotspot evidence available"
                      : `${hotspot.commitCount ?? 0} commits in recent history • ${hotspot.churnTotal ?? 0} total churn`}
                  </BodySm>
                </div>
              </div>
              <QuietAction type="button">Review Hotspot</QuietAction>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                <div className="relative h-48 overflow-hidden rounded-lg bg-surface-container">
                  <img
                    alt="Abstract data visualization showing a dense web of red connections representing code dependency debt"
                    className="absolute inset-0 h-full w-full object-cover opacity-30 mix-blend-overlay"
                    src={dependencyMapImage}
                  />
                  <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-surface-container/90 to-transparent p-4">
                    <MetaLabel as="span" className="text-[10px]">
                      Dependency Map
                    </MetaLabel>
                    <span className="text-sm font-semibold">Recursive Growth Trend</span>
                  </div>
                </div>

                <div className="space-y-4">
                  <BodyMd className="text-[0.875rem]">{hotspotNarrative(report)}</BodyMd>
                  <ul className="space-y-2">
                    {hotspotFindings.map((finding) => (
                      <li className="flex items-center gap-2 text-xs text-on-surface" key={finding}>
                        <span className="h-1.5 w-1.5 rounded-full bg-error" />
                        {finding}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </SurfaceCard>
        </div>

        <div className="space-y-6">
          <SectionHeading as="h3">Top Critical Issues</SectionHeading>
          <div className="space-y-4">
            {criticalIssues.map((issue) => (
              <IssueCard
                copy={issue.copy}
                infoTitle={issue.info}
                key={`${issue.tag}-${issue.title}`}
                tag={issue.tag}
                title={issue.title}
              />
            ))}
          </div>

          <div className="pt-4">
            <SurfaceInset className="group flex w-full items-center justify-between bg-surface-container p-4 text-on-surface transition-colors hover:bg-surface-container-high">
              <span className="text-sm font-semibold">
                View All {report.health.topIssues.length} Findings
              </span>
              <MaterialSymbol
                className="transition-transform group-hover:translate-x-1"
                icon="arrow_forward"
              />
            </SurfaceInset>
          </div>
        </div>
      </div>
    </main>
  );
};
