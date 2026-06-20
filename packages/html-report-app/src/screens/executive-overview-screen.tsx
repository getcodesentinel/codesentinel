import type { CodeSentinelReport } from "@codesentinel/reporter";
import {
  createExecutiveCriticalIssues,
  formatScore,
  getDimensionLevel,
  getHealthChipLabel,
  getHealthTone,
  getRiskChipLabel,
  getRiskTone,
} from "../app/report-data";
import { QuietAction } from "../components/design/actions";
import { IssueCard } from "../components/design/issue-card";
import { SurfaceCard, SurfacePanel } from "../components/design/surfaces";
import {
  BodyMd,
  BodySm,
  LabelSm,
  MetaLabel,
  MetricUnit,
  MetricValue,
  SectionHeading,
} from "../components/design/typography";
import { PageIntro } from "../components/design/page-intro";
import { MaterialSymbol } from "../components/material-symbol";
import { cn } from "../lib/utils";

const dependencyMapImage =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuCJigVZgnvdShuL8jTrcBixUhdfhUho12np-HxRvjubWPuJadXUCjU45Ynm9JQ-Dx9Re9rCa9fZY7S2tUIts_ef4jOVEWJMwm92YJGYKYjUEr2sjtJCBjEnHvrYtY7yllk09WElGK68DF4tgV8n1b1DeoPexRqHVquOujwG8IPWRuL9phHFKQwrqdrun4q1Vfn3lVgHG3bUEkaZTuvuWOCq2tigZmb8bPUiYWhXJhnJvXMLFRlDzbp60axW2CMG-0AfA7VP3Rr8CiQ";

type ExecutiveOverviewScreenProps = {
  report: CodeSentinelReport;
};

const navigateToScreen = (screen: string): void => {
  window.location.hash = screen;
  window.scrollTo({ top: 0, behavior: "smooth" });
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

const hasWorkspaceSummary = (report: CodeSentinelReport): boolean =>
  report.workspaces.risk.length > 0 ||
  report.workspaces.structural.length > 0 ||
  report.workspaces.evolution.length > 0 ||
  report.workspaces.external.length > 0;

const formatInteger = (value: number): string => new Intl.NumberFormat().format(value);

export const ExecutiveOverviewScreen = ({ report }: ExecutiveOverviewScreenProps) => {
  const focus = getCurrentFocus(report);
  const hotspot = getImmediateHotspot(report);
  const criticalIssues = createExecutiveCriticalIssues(report);
  const hotspotFindings = hotspotFindingCopy(report);
  const riskTone = getRiskTone(report.repository.riskTier);
  const healthTone = getHealthTone(report.health.healthScore);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-12 p-4 md:p-8">
      <PageIntro
        aside={
          <div className="flex items-center gap-2 rounded-full border border-outline-variant/10 bg-surface-container-low px-4 py-2">
            <MaterialSymbol className="text-[18px] text-error" icon="trending_up" />
            <span className="text-xs font-bold text-on-surface">{getRiskTrendText(report)}</span>
          </div>
        }
        description={getHeroSummary(report)}
        label="Current Focus"
        title={focus}
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-12">
        <SurfaceCard className="flex flex-col justify-between p-8 md:col-span-1 lg:col-span-4">
          <div>
            <div className="mb-4 flex items-start justify-between">
              <LabelSm as="span" className="tracking-widest">
                Risk Score
              </LabelSm>
              <MaterialSymbol className={riskTone.iconClassName} icon="warning" />
            </div>
            <div className="flex items-baseline gap-2">
              <MetricValue as="span" className="text-6xl font-bold tracking-tighter">
                {formatScore(report.repository.riskScore)}
              </MetricValue>
              <MetricUnit as="span">/ 100</MetricUnit>
            </div>
            <div className={`mt-4 ${riskTone.chipClassName}`}>
              {getRiskChipLabel(report.repository.riskTier)}
            </div>
          </div>
          <div className="mt-8">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
              <div
                className={`h-full rounded-full ${riskTone.meterClassName}`}
                style={{ width: `${Math.max(0, Math.min(100, report.repository.riskScore))}%` }}
              />
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard
          className={`flex flex-col justify-between border-l-4 p-8 md:col-span-1 lg:col-span-4 ${healthTone.accentBorderClassName}`}
        >
          <div>
            <div className="mb-4 flex items-start justify-between">
              <LabelSm as="span" className="tracking-widest">
                Health Posture
              </LabelSm>
              <MaterialSymbol className={healthTone.iconClassName} icon="verified_user" />
            </div>
            <div className="flex items-baseline gap-2">
              <MetricValue as="span" className="text-6xl font-bold tracking-tighter">
                {formatScore(report.health.healthScore)}
              </MetricValue>
              <MetricUnit as="span">/ 100</MetricUnit>
            </div>
            <div className={`mt-4 ${healthTone.chipClassName}`}>
              {getHealthChipLabel(report.health.healthScore)}
            </div>
          </div>
          <div className="mt-8">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
              <div
                className={`h-full rounded-full ${healthTone.meterClassName}`}
                style={{ width: `${Math.max(0, Math.min(100, report.health.healthScore))}%` }}
              />
            </div>
          </div>
        </SurfaceCard>

        <SurfacePanel className="space-y-6 p-8 md:col-span-2 lg:col-span-4">
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

      {hasWorkspaceSummary(report) && (
        <section className="space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <MetaLabel>Monorepo Overview</MetaLabel>
              <SectionHeading as="h3">Workspace pressure points</SectionHeading>
            </div>
            <BodySm className="max-w-2xl text-on-surface-variant">
              Workspace rankings combine structural ownership, risk scoring, git evolution, and
              external dependency exposure where each signal is available.
            </BodySm>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
            <SurfacePanel className="space-y-3 p-5">
              <LabelSm as="h4" className="tracking-widest">
                Top Risk
              </LabelSm>
              {report.workspaces.risk.slice(0, 3).map((workspace) => (
                <div className="flex items-center justify-between gap-3" key={workspace.path}>
                  <span className="min-w-0 truncate text-sm font-medium text-on-surface">
                    {workspace.path}
                  </span>
                  <span className="shrink-0 text-sm font-bold text-error">
                    {formatScore(workspace.score)}
                  </span>
                </div>
              ))}
              {report.workspaces.risk.length === 0 && (
                <BodySm className="text-on-surface-variant">No workspace risk scores.</BodySm>
              )}
            </SurfacePanel>

            <SurfacePanel className="space-y-3 p-5">
              <LabelSm as="h4" className="tracking-widest">
                Coupling
              </LabelSm>
              {report.workspaces.structural.slice(0, 3).map((workspace) => (
                <div className="space-y-1" key={workspace.path}>
                  <div className="truncate text-sm font-medium text-on-surface">
                    {workspace.path}
                  </div>
                  <div className="text-xs text-on-surface-variant">
                    {formatInteger(workspace.incomingEdgeCount)} in •{" "}
                    {formatInteger(workspace.outgoingEdgeCount)} out
                  </div>
                </div>
              ))}
              {report.workspaces.structural.length === 0 && (
                <BodySm className="text-on-surface-variant">No workspace coupling data.</BodySm>
              )}
            </SurfacePanel>

            <SurfacePanel className="space-y-3 p-5">
              <LabelSm as="h4" className="tracking-widest">
                Evolution
              </LabelSm>
              {report.workspaces.evolution.slice(0, 3).map((workspace) => (
                <div className="space-y-1" key={workspace.path}>
                  <div className="truncate text-sm font-medium text-on-surface">
                    {workspace.path}
                  </div>
                  <div className="text-xs text-on-surface-variant">
                    {formatInteger(workspace.commitCount)} commits •{" "}
                    {formatInteger(workspace.churnTotal)} churn
                  </div>
                </div>
              ))}
              {report.workspaces.evolution.length === 0 && (
                <BodySm className="text-on-surface-variant">No workspace evolution data.</BodySm>
              )}
            </SurfacePanel>

            <SurfacePanel className="space-y-3 p-5">
              <LabelSm as="h4" className="tracking-widest">
                Dependencies
              </LabelSm>
              {report.workspaces.external.slice(0, 3).map((workspace) => (
                <div className="space-y-1" key={workspace.path}>
                  <div className="truncate text-sm font-medium text-on-surface">
                    {workspace.path}
                  </div>
                  <div className="text-xs text-on-surface-variant">
                    {formatInteger(workspace.directDependencies)} direct •{" "}
                    {formatInteger(workspace.sharedDependencies.length)} shared
                  </div>
                </div>
              ))}
              {report.workspaces.external.length === 0 && (
                <BodySm className="text-on-surface-variant">No workspace dependency data.</BodySm>
              )}
            </SurfacePanel>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <SectionHeading as="h3" className="flex items-center gap-2">
              <MaterialSymbol icon="priority_high" />
              Immediate Attention Required
            </SectionHeading>
          </div>

          <SurfaceCard className="overflow-hidden shadow-xs">
            <div className="flex flex-col justify-between gap-4 border-b border-surface-container-low p-6 sm:flex-row sm:items-center">
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
              <QuietAction onClick={() => navigateToScreen("hotspots")} type="button">
                Review Hotspot
              </QuietAction>
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
            <button
              className={cn(
                "ds-surface-inset",
                "group flex w-full items-center justify-between bg-surface-container p-4 text-on-surface transition-colors hover:bg-surface-container-high",
              )}
              onClick={() => navigateToScreen("health-posture")}
              type="button"
            >
              <span className="text-sm font-semibold">
                View All {report.health.topIssues.length} Findings
              </span>
              <MaterialSymbol
                className="transition-transform group-hover:translate-x-1"
                icon="arrow_forward"
              />
            </button>
          </div>
        </div>
      </div>
    </main>
  );
};
