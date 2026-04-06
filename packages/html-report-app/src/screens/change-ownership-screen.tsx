import type {
  CodeSentinelReport,
  CoChangePairReportItem,
  HotspotReportItem,
  ModuleKnowledgeReportItem,
} from "@codesentinel/reporter";
import { PageIntro } from "../components/design/page-intro";
import { SurfaceCard, SurfacePanel } from "../components/design/surfaces";
import { BodyMd, MetaLabel, TitleMd } from "../components/design/typography";
import { MaterialSymbol } from "../components/material-symbol";
import { cn } from "../lib/utils";

type ChangeOwnershipScreenProps = {
  report: CodeSentinelReport;
};

const formatPercent = (value: number | null | undefined): string => {
  if (value === null || value === undefined) {
    return "n/a";
  }

  return `${Math.round(value)}%`;
};

const compactPath = (value: string): string => value.split("/").filter(Boolean).slice(-2).join("/");

const heroDescription = (report: CodeSentinelReport): string => {
  if (!report.changeOwnership.available) {
    return "Tracing the human footprint across the codebase. Identifying high-churn volatility and areas with dangerous knowledge silos.";
  }

  const topHotspot = [...report.hotspots]
    .filter((hotspot) => hotspot.recentCommitCount !== null)
    .sort((a, b) => (b.recentCommitCount ?? 0) - (a.recentCommitCount ?? 0))[0];

  if (topHotspot !== undefined) {
    return `Tracing the human footprint across the codebase. Recent change pressure is concentrated around ${topHotspot.module}, where ownership concentration and sustained churn are increasing coordination risk.`;
  }

  return "Tracing the human footprint across the codebase. Identifying high-churn volatility and areas with dangerous knowledge silos.";
};

const churnRows = (report: CodeSentinelReport): readonly HotspotReportItem[] =>
  [...report.hotspots]
    .filter((hotspot) => hotspot.recentCommitCount !== null)
    .sort(
      (a, b) =>
        (b.recentCommitCount ?? 0) - (a.recentCommitCount ?? 0) ||
        (b.recentVolatility ?? 0) - (a.recentVolatility ?? 0) ||
        a.target.localeCompare(b.target),
    )
    .slice(0, 5);

const hotspotSignal = (
  hotspot: HotspotReportItem,
): { label: string; className: string; dotClassName: string } => {
  const volatility = hotspot.recentVolatility ?? 0;
  const topAuthorShare = hotspot.topAuthorShareByCommits ?? 0;

  if (volatility >= 0.7 || topAuthorShare >= 0.85) {
    return {
      label: "Unstable",
      className: "text-error",
      dotClassName: "bg-error",
    };
  }

  if (volatility >= 0.45 || topAuthorShare >= 0.65) {
    return {
      label: "Active",
      className: "text-tertiary",
      dotClassName: "bg-tertiary",
    };
  }

  return {
    label: "Normal",
    className: "text-on-surface-variant",
    dotClassName: "bg-outline-variant",
  };
};

const relationTone = (
  pair: CoChangePairReportItem,
): { chipClassName: string; label: string; note: string } => {
  if (pair.couplingScore >= 0.85) {
    return {
      chipClassName: "bg-tertiary-container/10 text-tertiary",
      label: "Structural Debt",
      note: "These files tend to move together, suggesting a stable but costly seam.",
    };
  }

  return {
    chipClassName: "bg-error-container/10 text-error",
    label: "Hidden Dependency",
    note: "The co-change signal is strong enough to suggest an implicit dependency.",
  };
};

const ownershipInsight = (report: CodeSentinelReport): string => {
  if (!report.changeOwnership.available) {
    return "Ownership concentration details are unavailable for this snapshot.";
  }

  const riskiestModule = [...report.changeOwnership.moduleKnowledge].sort(
    (a, b) =>
      b.topAuthorShareByCommits - a.topAuthorShareByCommits || a.module.localeCompare(b.module),
  )[0];

  if (riskiestModule === undefined) {
    return "Ownership concentration details are unavailable for this snapshot.";
  }

  const concentration = Math.round(riskiestModule.topAuthorShareByCommits * 100);
  const riskLevel = concentration >= 85 ? "High" : concentration >= 65 ? "Moderate" : "Contained";
  return `${concentration}% of ${compactPath(riskiestModule.module)} is currently concentrated under a narrow set of contributors. Transition risk is ${riskLevel}.`;
};

const ownershipTone = (
  label: ModuleKnowledgeReportItem["ownershipLabel"],
): { className: string; textClassName: string; icon?: string; meta?: string } => {
  switch (label) {
    case "distributed":
      return {
        className: "bg-tertiary",
        textClassName: "text-on-primary",
        icon: "check_circle",
      };
    case "sparse":
      return {
        className: "bg-tertiary/40",
        textClassName: "text-on-surface",
        meta: "Sparse",
      };
    case "siloed":
      return {
        className: "border border-error/30 bg-error/20",
        textClassName: "text-error",
        icon: "warning",
      };
  }
};

const moduleLabel = (value: string): string =>
  value
    .split("/")
    .filter(Boolean)
    .slice(-2)
    .join(" / ")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (segment) => segment.toUpperCase()) || "Root";

const volatilityBars = (report: CodeSentinelReport): readonly number[] => {
  const values = report.hotspots
    .map((hotspot) => hotspot.recentVolatility)
    .filter((value): value is number => value !== null)
    .slice(0, 15);

  if (values.length === 0) {
    return [20, 25, 40, 30, 60, 90, 50, 35, 30, 45, 55, 20, 85, 65, 40];
  }

  const max = Math.max(...values, 1);
  return values.map((value) => Math.max(18, Math.round((value / max) * 100)));
};

export const ChangeOwnershipScreen = ({ report }: ChangeOwnershipScreenProps) => {
  const summary = report.changeOwnership.available ? report.changeOwnership.metrics : null;
  const coChangePairs = report.changeOwnership.available
    ? report.changeOwnership.coChangePairs
    : [];
  const moduleKnowledge = report.changeOwnership.available
    ? report.changeOwnership.moduleKnowledge
    : [];
  const bars = volatilityBars(report);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-10 p-4 md:p-8">
      <PageIntro
        aside={
          <div className="flex items-center gap-4 rounded-xl bg-surface-container-low p-2">
            <div className="rounded-lg bg-surface-container-lowest px-4 py-2 text-center shadow-sm">
              <MetaLabel as="p">Mean Bus Factor</MetaLabel>
              <p className="text-xl font-semibold text-error">
                {summary?.meanBusFactorByCommits === null ||
                summary?.meanBusFactorByCommits === undefined
                  ? "n/a"
                  : summary.meanBusFactorByCommits.toFixed(1)}
              </p>
            </div>
            <div className="rounded-lg bg-surface-container-lowest px-4 py-2 text-center shadow-sm">
              <MetaLabel as="p">30d Volatility</MetaLabel>
              <p className="text-xl font-semibold text-tertiary">
                {formatPercent(summary?.averageRecentVolatility)}
              </p>
            </div>
          </div>
        }
        description={heroDescription(report)}
        label="History & Sociology"
        labelClassName="text-tertiary"
        title="Change & Ownership"
      />

      <section className="grid grid-cols-12 gap-6">
        <SurfacePanel className="relative col-span-12 overflow-hidden rounded-2xl p-8 lg:col-span-8">
          <div className="relative z-10">
            <TitleMd as="h3" className="mb-6 flex items-center gap-2">
              <MaterialSymbol className="text-primary" icon="trending_up" />
              Recent Activity Volatility (Last 30 Days)
            </TitleMd>
            <div className="mt-4 flex h-48 items-end justify-between gap-1">
              {bars.map((height, index) => (
                <div
                  className={cn(
                    "w-full rounded-t-sm",
                    height >= 80
                      ? "bg-error-container/40"
                      : height >= 55
                        ? "bg-tertiary/40"
                        : "bg-tertiary/20",
                  )}
                  key={`${height}-${index}`}
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
            <div className="mt-4 flex justify-between text-[0.6875rem] font-bold uppercase tracking-widest text-on-surface-variant">
              <span>Start</span>
              <span>Mid-Window Peak</span>
              <span>Today</span>
            </div>
          </div>
        </SurfacePanel>

        <SurfaceCard className="col-span-12 rounded-2xl border border-outline-variant/10 p-8 shadow-sm lg:col-span-4">
          <TitleMd as="h3" className="mb-6 flex items-center gap-2">
            <MaterialSymbol className="text-primary" icon="groups" />
            Ownership Concentration
          </TitleMd>
          <div className="space-y-6">
            <div>
              <div className="mb-2 flex justify-between">
                <span className="text-[0.875rem] font-medium">Shared Ownership</span>
                <span className="text-[0.875rem] font-semibold">
                  {formatPercent(summary?.sharedOwnershipPercent)}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
                <div
                  className="h-full rounded-full bg-tertiary"
                  style={{ width: `${summary?.sharedOwnershipPercent ?? 0}%` }}
                />
              </div>
            </div>

            <div>
              <div className="mb-2 flex justify-between">
                <span className="text-[0.875rem] font-medium text-error">
                  Single Maintainer (Risk)
                </span>
                <span className="text-[0.875rem] font-semibold text-error">
                  {formatPercent(summary?.singleMaintainerPercent)}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
                <div
                  className="h-full rounded-full bg-error"
                  style={{ width: `${summary?.singleMaintainerPercent ?? 0}%` }}
                />
              </div>
            </div>

            <div>
              <div className="mb-2 flex justify-between">
                <span className="text-[0.875rem] font-medium">Concentrated Ownership</span>
                <span className="text-[0.875rem] font-semibold">
                  {formatPercent(summary?.concentratedOwnershipPercent)}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
                <div
                  className="h-full rounded-full bg-secondary"
                  style={{ width: `${summary?.concentratedOwnershipPercent ?? 0}%` }}
                />
              </div>
            </div>
          </div>
          <div className="mt-8 border-t border-outline-variant/10 pt-6">
            <p className="text-[0.6875rem] leading-relaxed text-on-surface-variant">
              <span className="font-bold">INSIGHT:</span> {ownershipInsight(report)}
            </p>
          </div>
        </SurfaceCard>
      </section>

      <section className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <section>
          <div className="mb-6 flex items-center justify-between">
            <TitleMd as="h3">High Churn Hotspots</TitleMd>
            <span className="rounded bg-surface-container px-2 py-1 text-[0.6875rem] font-bold uppercase text-on-surface-variant">
              Top 5 Files
            </span>
          </div>
          <div className="overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-surface-container-low text-[0.6875rem] font-bold uppercase tracking-widest text-on-surface-variant">
                  <th className="px-6 py-4">File Path</th>
                  <th className="px-6 py-4">Revisions (30d)</th>
                  <th className="px-6 py-4">Risk Signal</th>
                </tr>
              </thead>
              <tbody>
                {churnRows(report).map((hotspot) => {
                  const signal = hotspotSignal(hotspot);
                  return (
                    <tr
                      className="transition-colors hover:bg-surface-container-low"
                      key={hotspot.target}
                    >
                      <td className="px-6 py-4 font-mono text-[0.75rem]">{hotspot.target}</td>
                      <td className="px-6 py-4">{hotspot.recentCommitCount ?? 0}</td>
                      <td className="px-6 py-4">
                        <span
                          className={cn("flex items-center gap-1 font-semibold", signal.className)}
                        >
                          <span className={cn("h-1.5 w-1.5 rounded-full", signal.dotClassName)} />
                          {signal.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <div className="mb-6 flex items-center justify-between">
            <TitleMd as="h3">Co-change Relationships</TitleMd>
            <MaterialSymbol className="text-primary-fixed-dim" icon="info" />
          </div>
          <div className="space-y-4">
            {coChangePairs.slice(0, 2).map((pair) => {
              const tone = relationTone(pair);
              return (
                <div
                  className={cn(
                    "rounded-xl border-l-4 bg-surface-container-low p-5",
                    pair.couplingScore >= 0.85
                      ? "border-tertiary-container/40"
                      : "border-error-container/40",
                  )}
                  key={`${pair.fileA}-${pair.fileB}`}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span
                      className={cn(
                        "rounded px-2 py-0.5 text-[0.6875rem] font-bold uppercase",
                        tone.chipClassName,
                      )}
                    >
                      {Math.round(pair.couplingScore * 100)}% Coupled
                    </span>
                    <span className="text-[0.6875rem] font-medium text-on-surface-variant">
                      {tone.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 font-mono text-[0.75rem] text-body-md">
                    <div className="min-w-0 flex-1 truncate rounded bg-surface-container-lowest p-2">
                      {compactPath(pair.fileA)}
                    </div>
                    <MaterialSymbol className="text-outline" icon="link" />
                    <div className="min-w-0 flex-1 truncate rounded bg-surface-container-lowest p-2">
                      {compactPath(pair.fileB)}
                    </div>
                  </div>
                  <p className="mt-3 text-[0.75rem] italic text-on-surface-variant">{tone.note}</p>
                </div>
              );
            })}
          </div>
        </section>
      </section>

      <section className="rounded-3xl border border-outline-variant/10 bg-surface-container-lowest p-10 shadow-sm">
        <div className="flex flex-col items-start gap-12 md:flex-row">
          <div className="w-full md:w-1/3">
            <TitleMd as="h3" className="mb-4">
              Knowledge Heatmap
            </TitleMd>
            <BodyMd className="mb-6 leading-relaxed">
              Visualizing the distribution of commits across system modules. High saturation
              indicates collaborative areas; low saturation indicates siloed knowledge.
            </BodyMd>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 rounded bg-tertiary" />
                <span className="text-[0.875rem] font-medium text-on-surface">
                  Distributed (Healthy)
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 rounded bg-tertiary/40" />
                <span className="text-[0.875rem] font-medium text-on-surface">
                  Sparse Knowledge
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 rounded border border-error/30 bg-error/20" />
                <span className="text-[0.875rem] font-medium text-on-surface">
                  Critically Siloed
                </span>
              </div>
            </div>
          </div>

          <div className="grid h-64 w-full flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
            {moduleKnowledge.slice(0, 8).map((module) => {
              const tone = ownershipTone(module.ownershipLabel);
              return (
                <div
                  className={cn(
                    "flex flex-col justify-between rounded-lg p-3 transition-transform hover:scale-[1.02]",
                    tone.className,
                  )}
                  key={module.module}
                >
                  <span className={cn("text-[0.6875rem] font-bold uppercase", tone.textClassName)}>
                    {moduleLabel(module.module)}
                  </span>
                  {tone.icon !== undefined ? (
                    <MaterialSymbol className={tone.textClassName} icon={tone.icon} />
                  ) : (
                    <span className={cn("text-[0.625rem] opacity-80", tone.textClassName)}>
                      {module.activeAuthors} Active Devs
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
};
