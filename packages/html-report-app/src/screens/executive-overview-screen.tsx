import type { CodeSentinelReport } from "@codesentinel/reporter";
import {
  formatScore,
  getDimensionLevel,
  getHealthChipLabel,
  getRiskChipLabel,
} from "../app/report-data";
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

const getCriticalIssues = (report: CodeSentinelReport) =>
  report.health.topIssues.slice(0, 3).map((issue) => ({
    tag: issue.dimension,
    title: issue.id,
    copy: issue.message,
    info: issue.ruleId === undefined ? issue.signal : issue.ruleId,
  }));

export const ExecutiveOverviewScreen = ({ report }: ExecutiveOverviewScreenProps) => {
  const focus = getCurrentFocus(report);
  const hotspot = getImmediateHotspot(report);
  const criticalIssues = getCriticalIssues(report);

  return (
    <main className="max-w-7xl p-8">
      <section className="mb-12">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <h3 className="mb-1 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-on-surface-variant">
              Current Focus
            </h3>
            <h2 className="text-3xl font-semibold tracking-tight text-on-surface">{focus}</h2>
            <p className="mt-2 max-w-2xl text-[0.875rem] leading-relaxed text-on-surface-variant">
              {getHeroSummary(report)}
            </p>
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
        <div className="md:col-span-4 flex flex-col justify-between rounded-xl bg-surface-container-lowest p-8 shadow-[0_12px_40px_rgba(45,51,56,0.04)]">
          <div>
            <div className="mb-4 flex items-start justify-between">
              <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-on-surface-variant">
                Risk Score
              </span>
              <MaterialSymbol className="text-error" icon="warning" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-6xl font-bold tracking-tighter text-on-surface">
                {formatScore(report.repository.riskScore)}
              </span>
              <span className="font-medium text-on-surface-variant">/ 100</span>
            </div>
            <div className="mt-4 inline-flex items-center rounded-full bg-error-container/20 px-2.5 py-0.5 text-xs font-bold text-on-error-container">
              {getRiskChipLabel(report.repository.riskTier)}
            </div>
          </div>
          <div className="mt-8">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
              <div
                className="h-full rounded-full bg-error"
                style={{ width: `${Math.max(0, Math.min(100, report.repository.riskScore))}%` }}
              />
            </div>
          </div>
        </div>

        <div className="md:col-span-4 flex flex-col justify-between rounded-xl border-l-4 border-tertiary bg-surface-container-lowest p-8 shadow-[0_12px_40px_rgba(45,51,56,0.04)]">
          <div>
            <div className="mb-4 flex items-start justify-between">
              <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-on-surface-variant">
                Health Posture
              </span>
              <MaterialSymbol className="text-tertiary" icon="verified_user" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-6xl font-bold tracking-tighter text-on-surface">
                {formatScore(report.health.healthScore)}
              </span>
              <span className="font-medium text-on-surface-variant">/ 100</span>
            </div>
            <div className="mt-4 inline-flex items-center rounded-full bg-tertiary-container/20 px-2.5 py-0.5 text-xs font-bold text-tertiary">
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
        </div>

        <div className="md:col-span-4 space-y-6 rounded-xl border border-outline-variant/10 bg-surface-container-low p-8">
          <h4 className="text-[0.6875rem] font-bold uppercase tracking-widest text-on-surface-variant">
            Core Dimensions
          </h4>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-on-surface">Structural Integrity</span>
              <span className="text-xs font-bold text-on-surface-variant">
                {getDimensionLevel(report.repository.dimensionScores.structural)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-on-surface">Change Velocity</span>
              <span className="text-xs font-bold text-on-surface-variant">
                {getDimensionLevel(report.repository.dimensionScores.evolution)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-on-surface">Dependency Depth</span>
              <span className="text-xs font-bold text-on-surface-variant">
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
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-[1.5rem] font-medium text-on-surface">
              <MaterialSymbol icon="priority_high" />
              Immediate Attention Required
            </h3>
          </div>

          <div className="overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm">
            <div className="flex items-center justify-between border-b border-surface-container-low p-6">
              <div className="flex items-center gap-4">
                <div className="rounded-lg bg-error-container/10 p-3">
                  <MaterialSymbol className="text-error" icon="bolt" />
                </div>
                <div>
                  <h4 className="text-[1.125rem] font-semibold text-on-surface">
                    {hotspot === undefined
                      ? "Unstable Hotspot: unavailable"
                      : `Unstable Hotspot: ${hotspot.target}`}
                  </h4>
                  <p className="text-xs text-on-surface-variant">
                    {hotspot === undefined
                      ? "No hotspot evidence available"
                      : `${hotspot.commitCount ?? 0} commits in recent history • ${hotspot.churnTotal ?? 0} total churn`}
                  </p>
                </div>
              </div>
              <button className="text-sm font-bold text-tertiary hover:underline" type="button">
                Review Hotspot
              </button>
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
                    <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                      Dependency Map
                    </span>
                    <span className="text-sm font-semibold">Recursive Growth Trend</span>
                  </div>
                </div>

                <div className="space-y-4">
                  <p className="text-[0.875rem] leading-relaxed text-on-surface-variant">
                    {hotspot === undefined
                      ? "No hotspot narrative is available for this report."
                      : `${hotspot.target} is becoming a central pressure point. Multiple contributors are likely converging here, increasing regression risk and review load.`}
                  </p>
                  <ul className="space-y-2">
                    {(hotspot?.topFactors.slice(0, 2) ?? []).map((factor) => (
                      <li
                        className="flex items-center gap-2 text-xs text-on-surface"
                        key={factor.id}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-error" />
                        {factor.label} ({formatScore(factor.contribution)})
                      </li>
                    ))}
                    {(hotspot?.topFactors.length ?? 0) === 0 ? (
                      <li className="flex items-center gap-2 text-xs text-on-surface">
                        <span className="h-1.5 w-1.5 rounded-full bg-error" />
                        No top factor evidence available in this snapshot
                      </li>
                    ) : null}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <h3 className="text-[1.5rem] font-medium text-on-surface">Top Critical Issues</h3>
          <div className="space-y-4">
            {criticalIssues.map((issue) => (
              <div
                className="group rounded-xl border-l-4 border-error/50 bg-surface-container-lowest p-5 shadow-sm transition-all hover:shadow-md"
                key={`${issue.tag}-${issue.title}`}
              >
                <div className="mb-2 flex items-start justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-error">
                    {issue.tag}
                  </span>
                  <MaterialSymbol
                    className="cursor-help text-[16px] text-on-surface-variant"
                    icon="info"
                  />
                </div>
                <h4 className="mb-1 text-sm font-bold text-on-surface">{issue.title}</h4>
                <p className="text-xs leading-relaxed text-on-surface-variant">{issue.copy}</p>
              </div>
            ))}
          </div>

          <div className="pt-4">
            <button
              className="group flex w-full items-center justify-between rounded-xl bg-surface-container p-4 text-on-surface transition-colors hover:bg-surface-container-high"
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
