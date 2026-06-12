import type {
  CodeSentinelReport,
  HotspotReportItem,
  RiskyDependencyReportItem,
} from "@codesentinel/reporter";
import { formatScore, getRiskTone } from "../app/report-data";
import { PrimaryButton } from "../components/design/actions";
import { PageIntro } from "../components/design/page-intro";
import {
  ReportTable,
  ReportTableCell,
  ReportTableHeaderCell,
  ReportTableRow,
  ReportTableScroll,
} from "../components/design/report-table";
import { SurfaceCard, SurfaceInset, SurfacePanel } from "../components/design/surfaces";
import { BodyMd, TitleMd } from "../components/design/typography";
import { MaterialSymbol } from "../components/material-symbol";

type RiskDriversScreenProps = {
  report: CodeSentinelReport;
};

const asPercent = (value: number | null | undefined): number => {
  if (value === null || value === undefined) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
};

const riskExposureLabel = (score: number): string => {
  if (score >= 80) {
    return "Severe Risk Exposure";
  }
  if (score >= 60) {
    return "High Risk Exposure";
  }
  if (score >= 40) {
    return "Elevated Risk Exposure";
  }
  return "Moderate Risk Exposure";
};

const getTopHotspots = (report: CodeSentinelReport): readonly HotspotReportItem[] =>
  report.hotspots.slice(0, 4);

const getStructuralObservation = (report: CodeSentinelReport): string => {
  const topHub = report.structural.fanInOutExtremes.highestFanIn[0];
  if (report.structural.cycleCount > 0) {
    return `${report.structural.cycleCount} circular dependency clusters are increasing structural drag across ${report.structural.cycleDetails.slice(0, 4).length || 1} critical seams.`;
  }
  if (topHub !== undefined) {
    return `${topHub.file} is acting as a structural hub with elevated fan-in pressure across the ${topHub.module} module.`;
  }

  return "Structural coupling remains the primary source of systemic fragility in the current snapshot.";
};

const getEvolutionEvidence = (report: CodeSentinelReport): string => {
  const hotspot = report.hotspots[0];
  if (hotspot?.commitCount !== null && hotspot?.commitCount !== undefined) {
    return `${hotspot.commitCount}% of recent hotspot activity is concentrated around ${hotspot.module || hotspot.target}.`;
  }

  return "Recent change pressure is concentrated in a narrow set of files with high downstream sensitivity.";
};

const getDependencyImpact = (dependency: RiskyDependencyReportItem | undefined): string => {
  if (dependency !== undefined) {
    return dependency.reason;
  }

  return "Dependency pressure is present, but no external analysis details were available for this snapshot.";
};

const formatDependencySignal = (signal: string): string =>
  signal
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const getVolatilityLabel = (score: number | null | undefined): string => {
  const value = score ?? 0;
  if (value >= 75) {
    return "Extreme";
  }
  if (value >= 55) {
    return "Elevated";
  }
  if (value >= 35) {
    return "Moderate";
  }
  return "Contained";
};

const getFailureImpact = (hotspot: HotspotReportItem): string => {
  const pressure =
    hotspot.riskContributions.structural +
    hotspot.riskContributions.evolution +
    hotspot.riskContributions.external;
  const probability = Math.min(99, Math.max(8, Math.round((pressure / 3) * 100)));
  if (probability >= 65) {
    return `${probability}% Timeout Prob`;
  }
  if (probability >= 35) {
    return `${probability}% Latency Spike`;
  }
  return `${probability}% Regression Risk`;
};

const getTopRiskDependencies = (
  report: CodeSentinelReport,
): readonly RiskyDependencyReportItem[] =>
  report.external.available ? report.external.riskyDependencies.slice(0, 3) : [];

const getSingleMaintainerCount = (report: CodeSentinelReport): number =>
  report.external.available ? report.external.singleMaintainerDependencies.length : 0;

const getStaleDependencyCount = (report: CodeSentinelReport): number =>
  report.external.available ? report.external.riskyDependencies.length : 0;

const getVulnerableDependencyCount = (report: CodeSentinelReport): number =>
  report.external.available ? report.external.highRiskDependencies.length : 0;

const wrapPathLikeText = (value: string): string => value;

export const RiskDriversScreen = ({ report }: RiskDriversScreenProps) => {
  const topHotspots = getTopHotspots(report);
  const topRiskDependencies = getTopRiskDependencies(report);
  const fanInPercent = asPercent(report.structural.fanInOutExtremes.highestFanIn[0]?.value);
  const interactionPercent = asPercent(report.repository.dimensionScores.interactions);
  const riskTone = getRiskTone(report.repository.riskTier);
  const sparkHeights = topHotspots.slice(0, 4).map((hotspot) => {
    const commitCount = hotspot.commitCount ?? 0;
    return Math.max(
      25,
      Math.min(
        100,
        Math.round((commitCount / Math.max(1, topHotspots[0]?.commitCount ?? 1)) * 100),
      ),
    );
  });

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-12 p-4 md:p-8">
      <PageIntro
        aside={
          <div className="flex flex-col items-start md:items-end">
            <div className="text-[3rem] font-semibold leading-none tracking-tighter text-on-surface">
              {formatScore(report.repository.riskScore)}
              <span className="text-xl font-normal text-on-surface-variant">/100</span>
            </div>
            <div
              className={`mt-2 rounded px-2 py-1 text-[0.6875rem] font-bold uppercase tracking-wider ${riskTone.chipClassName}`}
            >
              {riskExposureLabel(report.repository.riskScore || 0)}
            </div>
          </div>
        }
        description={
          <>
            This breakdown analyzes the structural integrity, historical volatility, and third-party
            dependencies of the{" "}
            <span className="font-semibold text-on-surface">Core Infrastructure</span> cluster. We
            identify high-pressure points where architectural complexity meets high change
            frequency.
          </>
        }
        label="Diagnostic Deep-Dive"
        labelClassName="text-tertiary"
        title="Risk Drivers & Fragility Assessment"
      />

      <section className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <SurfacePanel className="flex flex-col space-y-8 rounded-xl border-0 p-8">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <MaterialSymbol className="text-[20px] text-primary" icon="account_tree" />
              <TitleMd as="h4">Structural Risk</TitleMd>
            </div>
            <p className="text-xs font-medium text-on-surface-variant">
              Topological fragility and component coupling.
            </p>
          </div>
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="flex justify-between text-[0.6875rem] font-bold uppercase tracking-wider text-on-surface-variant">
                <span>High Fan-In Ratio</span>
                <span className="text-on-surface">{fanInPercent}%</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-surface-container-high">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(12, fanInPercent)}%` }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-[0.6875rem] font-bold uppercase tracking-wider text-on-surface-variant">
                <span>Centrality Index</span>
                <span className="text-on-surface">{interactionPercent}%</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-surface-container-high">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(12, interactionPercent)}%` }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-[0.6875rem] font-bold uppercase tracking-wider text-on-surface-variant">
                <span>Circular Deps</span>
                <span
                  className={
                    report.structural.cycleCount > 0 ? "font-bold text-error" : "text-on-surface"
                  }
                >
                  {report.structural.cycleCount} Clusters
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-surface-container-high">
                <div
                  className={
                    report.structural.cycleCount > 0
                      ? "h-full rounded-full bg-error"
                      : "h-full rounded-full bg-primary/35"
                  }
                  style={{
                    width: `${Math.max(8, Math.min(100, report.structural.cycleCount * 8))}%`,
                  }}
                />
              </div>
            </div>
          </div>
          <div className="mt-auto pt-6">
            <SurfaceCard className="rounded-lg border-l-4 border-primary p-4 shadow-none">
              <h5 className="mb-1 text-[0.6875rem] font-bold uppercase">Observation</h5>
              <p className="break-words text-xs leading-relaxed text-on-surface-variant [overflow-wrap:anywhere]">
                {wrapPathLikeText(getStructuralObservation(report))}
              </p>
            </SurfaceCard>
          </div>
        </SurfacePanel>

        <SurfacePanel className="flex flex-col space-y-8 rounded-xl border-0 p-8">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <MaterialSymbol className="text-[20px] text-primary" icon="history" />
              <TitleMd as="h4">Change Risk</TitleMd>
            </div>
            <p className="text-xs font-medium text-on-surface-variant">
              Churn volatility and historical regression frequency.
            </p>
          </div>
          <div className="space-y-6">
            <SurfaceCard className="rounded-lg p-4 shadow-none">
              <div className="mb-4 text-[0.6875rem] font-bold uppercase tracking-wider text-on-surface-variant">
                Churn Hotspots (Last 30d)
              </div>
              <ul className="space-y-3">
                {topHotspots.slice(0, 3).map((hotspot) => (
                  <li
                    className="flex items-start justify-between gap-3 text-xs"
                    key={hotspot.target}
                  >
                    <code className="min-w-0 flex-1 break-words whitespace-normal pr-2 text-tertiary [overflow-wrap:anywhere]">
                      {hotspot.target}
                    </code>
                    <span className="shrink-0 font-semibold text-on-surface">
                      {hotspot.commitCount ?? 0} commits
                    </span>
                  </li>
                ))}
              </ul>
            </SurfaceCard>
            <SurfaceCard className="flex items-center justify-between rounded-lg p-4 shadow-none">
              <div>
                <p className="text-[0.6875rem] font-bold uppercase text-on-surface-variant">
                  Volatility
                </p>
                <p className="text-xl font-semibold text-error">
                  {getVolatilityLabel(report.repository.dimensionScores.evolution)}
                </p>
              </div>
              <div className="flex h-8 w-16 items-end gap-0.5 bg-error/10 px-1">
                {sparkHeights.map((height, index) => (
                  <div
                    className="w-full bg-error"
                    key={`${height}-${index}`}
                    style={{ height: `${height}%` }}
                  />
                ))}
              </div>
            </SurfaceCard>
          </div>
          <div className="mt-auto pt-6">
            <SurfaceCard className="rounded-lg border-l-4 border-error p-4 shadow-none">
              <h5 className="mb-1 text-[0.6875rem] font-bold uppercase">Evidence</h5>
              <p className="break-words text-xs leading-relaxed text-on-surface-variant [overflow-wrap:anywhere]">
                {wrapPathLikeText(getEvolutionEvidence(report))}
              </p>
            </SurfaceCard>
          </div>
        </SurfacePanel>

        <SurfacePanel className="flex flex-col space-y-8 rounded-xl border-0 p-8">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <MaterialSymbol className="text-[20px] text-primary" icon="layers" />
              <TitleMd as="h4">Dependency Pressure</TitleMd>
            </div>
            <p className="text-xs font-medium text-on-surface-variant">
              External supply chain health and stale packages.
            </p>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <SurfaceCard className="rounded-lg p-4 text-center shadow-none">
                <p className="text-[0.6875rem] font-bold uppercase text-on-surface-variant">
                  Stale Deps
                </p>
                <p className="text-2xl font-semibold text-on-surface">
                  {getStaleDependencyCount(report)}
                </p>
              </SurfaceCard>
              <SurfaceCard className="rounded-lg p-4 text-center shadow-none">
                <p className="text-[0.6875rem] font-bold uppercase text-on-surface-variant">
                  Vulnerables
                </p>
                <p
                  className={
                    getVulnerableDependencyCount(report) > 0
                      ? "text-2xl font-semibold text-error"
                      : "text-2xl font-semibold text-on-surface"
                  }
                >
                  {getVulnerableDependencyCount(report)}
                </p>
              </SurfaceCard>
            </div>
            <SurfaceCard className="space-y-3 rounded-lg p-4 shadow-none">
              <p className="text-[0.6875rem] font-bold uppercase text-on-surface-variant">
                Single-Maintainer Trees
              </p>
              <div className="flex items-center gap-2">
                <MaterialSymbol className="text-[18px] text-error-container" icon="warning" />
                <span className="text-xs font-medium text-on-surface">
                  {getSingleMaintainerCount(report)} critical paths reliant on 1 dev
                </span>
              </div>
              <div className="flex h-24 w-full items-center justify-center rounded bg-surface-container-high/30">
                <div className="px-4 text-center text-[10px] italic text-on-surface-variant">
                  Dependency graph visualization hidden in this view
                </div>
              </div>
            </SurfaceCard>
          </div>
          <div className="mt-auto pt-6">
            <SurfaceCard className="rounded-lg border-l-4 border-tertiary p-4 shadow-none">
              <h5 className="mb-1 text-[0.6875rem] font-bold uppercase">Impact</h5>
              <p className="break-words text-xs leading-relaxed text-on-surface-variant [overflow-wrap:anywhere]">
                {topRiskDependencies[0]?.riskSignals.length
                  ? topRiskDependencies[0].riskSignals.map(formatDependencySignal).join(", ")
                  : getDependencyImpact(topRiskDependencies[0])}
              </p>
            </SurfaceCard>
          </div>
        </SurfacePanel>
      </section>

      <section className="grid grid-cols-1 items-start gap-12 pt-16 md:grid-cols-12">
        <div className="space-y-6 md:col-span-4">
          <SectionHeader />
          <BodyMd>
            Risk is rarely isolated. The convergence of{" "}
            <span className="italic">Structural Fragility</span> and{" "}
            <span className="italic">Change Risk</span> creates a multiplicative effect we define as
            the <strong>Critical Path Friction</strong>.
          </BodyMd>
          <div className="space-y-4 pt-4">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-primary-container">
                <MaterialSymbol className="text-primary" icon="hub" />
              </div>
              <div>
                <h6 className="text-sm font-semibold">Compound Failure Mode</h6>
                <p className="text-xs text-on-surface-variant">
                  Highly coupled components undergoing rapid change have a stronger downstream
                  outage probability than isolated hotspots.
                </p>
              </div>
            </div>
          </div>
        </div>

        <SurfaceCard className="rounded-2xl border border-outline-variant/10 p-10 shadow-[0_12px_40px_rgba(45,51,56,0.06)] md:col-span-8">
          <div className="mb-8 flex items-center justify-between">
            <TitleMd as="h4">Regression Sensitivity Matrix</TitleMd>
            <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
              Current Snapshot
            </span>
          </div>
          <div className="space-y-8">
            <ReportTableScroll>
              <ReportTable className="min-w-[44rem]">
                <thead>
                  <ReportTableRow className="border-b border-surface-container-high" hover={false}>
                    <ReportTableHeaderCell
                      className="bg-surface-container-lowest pb-3 pl-4 pr-4 pt-0 tracking-wider"
                      sticky
                    >
                      Risk Target
                    </ReportTableHeaderCell>
                    <ReportTableHeaderCell className="px-4 pb-3 pr-4 pt-0 tracking-wider">
                      Change Prob.
                    </ReportTableHeaderCell>
                    <ReportTableHeaderCell className="px-4 pb-3 pr-4 pt-0 tracking-wider">
                      Coupling Factor
                    </ReportTableHeaderCell>
                    <ReportTableHeaderCell
                      align="right"
                      className="px-4 pb-3 pr-4 pt-0 tracking-wider"
                    >
                      Failure Impact
                    </ReportTableHeaderCell>
                  </ReportTableRow>
                </thead>
                <tbody className="text-sm font-medium">
                  {topHotspots.slice(0, 4).map((hotspot) => (
                    <ReportTableRow
                      className="transition-colors hover:bg-surface-container-low"
                      key={hotspot.target}
                    >
                      <ReportTableCell className="py-4 pl-4 pr-4" sticky>
                        <code className="break-words text-tertiary [overflow-wrap:anywhere]">
                          {hotspot.target}
                        </code>
                      </ReportTableCell>
                      <ReportTableCell className="px-4 py-4 pr-4">
                        {hotspot.normalizedScore >= 0.7
                          ? `High (${hotspot.normalizedScore.toFixed(2)})`
                          : hotspot.normalizedScore >= 0.4
                            ? `Med (${hotspot.normalizedScore.toFixed(2)})`
                            : `Low (${hotspot.normalizedScore.toFixed(2)})`}
                      </ReportTableCell>
                      <ReportTableCell className="px-4 py-4 pr-4">
                        {hotspot.riskContributions.structural >= 0.7
                          ? `Critical (${Math.round(hotspot.riskContributions.structural * 10)})`
                          : hotspot.riskContributions.structural >= 0.4
                            ? `High (${Math.round(hotspot.riskContributions.structural * 10)})`
                            : `Low (${Math.round(hotspot.riskContributions.structural * 10)})`}
                      </ReportTableCell>
                      <ReportTableCell align="right" className="px-4 py-4 pr-4">
                        <span
                          className={
                            hotspot.riskContributions.structural +
                              hotspot.riskContributions.evolution >=
                            1
                              ? "text-error"
                              : ""
                          }
                        >
                          {getFailureImpact(hotspot)}
                        </span>
                      </ReportTableCell>
                    </ReportTableRow>
                  ))}
                </tbody>
              </ReportTable>
            </ReportTableScroll>

            <SurfaceInset className="flex items-center gap-4 rounded border border-outline-variant/10 p-4">
              <MaterialSymbol className="text-on-surface-variant" icon="lightbulb" />
              <p className="text-xs italic text-on-surface-variant">
                Refactoring the most coupled hotspot toward event-based seams would reduce
                regression sensitivity across adjacent modules.
              </p>
            </SurfaceInset>
          </div>
        </SurfaceCard>
      </section>

      <section className="hidden items-center justify-between rounded-xl border border-dashed border-outline-variant/50 bg-surface-container-high/30 p-8 max-md:flex-col max-md:items-start max-md:gap-6">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white bg-surface-container-lowest shadow-xs ring-4 ring-surface">
            <MaterialSymbol className="text-primary" icon="person" />
          </div>
          <div>
            <p className="text-xs font-semibold">Architect&apos;s Recommendation</p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Priority: {report.repository.riskScore >= 60 ? "High" : "Moderate"}
            </p>
          </div>
        </div>
        <div className="flex gap-4 max-md:w-full max-md:flex-col">
          <button className="rounded bg-surface-container-lowest px-6 py-2.5 text-sm font-semibold text-on-surface transition-colors hover:bg-white">
            Dismiss
          </button>
          <PrimaryButton className="px-6 py-2.5 text-sm font-semibold shadow-lg hover:shadow-xl">
            Schedule Architecture Review
          </PrimaryButton>
        </div>
      </section>
    </main>
  );
};

const SectionHeader = () => <h3 className="ds-headline-sm text-on-surface">Interaction Effects</h3>;
