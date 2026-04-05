import { useDeferredValue, useMemo, useState } from "react";
import type { CodeSentinelReport, HotspotReportItem } from "@codesentinel/reporter";
import { SurfaceCard, SurfacePanel } from "../components/design/surfaces";
import { BodyMd, LabelSm, TitleMd } from "../components/design/typography";
import { MaterialSymbol } from "../components/material-symbol";
import { cn } from "../lib/utils";

type HotspotsScreenProps = {
  report: CodeSentinelReport;
};

type HotspotFactor = HotspotReportItem["topFactors"][number];

const factorChip = (factor: HotspotFactor | undefined): { label: string; className: string } => {
  if (factor === undefined) {
    return {
      label: "MONITORED",
      className: "bg-surface-container-high text-on-surface-variant",
    };
  }

  if (factor.label.includes("volatility")) {
    return {
      label: "HIGH CHURN",
      className: "bg-error-container/10 text-on-error-container",
    };
  }

  if (factor.label.includes("interaction")) {
    return {
      label: "FRAGILE",
      className: "bg-error-container/10 text-on-error-container",
    };
  }

  if (factor.label.includes("structural")) {
    return {
      label: "MEDIUM",
      className: "bg-surface-container-high text-on-surface-variant",
    };
  }

  return {
    label: "FOCUS",
    className: "bg-tertiary/10 text-tertiary",
  };
};

const hotspotIcon = (factor: HotspotFactor | undefined): string => {
  if (factor?.label.includes("volatility")) {
    return "description";
  }
  if (factor?.label.includes("interaction")) {
    return "schema";
  }
  if (factor?.label.includes("structural")) {
    return "settings_ethernet";
  }
  return "description";
};

const hotspotIconClassName = (factor: HotspotFactor | undefined): string => {
  if (factor?.label.includes("volatility") || factor?.label.includes("interaction")) {
    return "bg-error-container/10 text-error";
  }
  return "bg-surface-container-high text-primary";
};

const scoreRingClassName = (score: number): string => {
  if (score >= 85) {
    return "border-error/20 bg-error-container/10 text-error";
  }
  if (score >= 70) {
    return "border-tertiary/20 bg-tertiary/10 text-tertiary";
  }
  return "border-outline-variant/20 text-on-surface";
};

const moduleLabel = (hotspot: HotspotReportItem): string =>
  hotspot.module.split("/").filter(Boolean).slice(-2).join(" / ") ||
  hotspot.module ||
  "Repository Core";

const percentFromContribution = (value: number): number =>
  Math.max(8, Math.min(100, Math.round(value * 100)));

const ownerEstimate = (hotspot: HotspotReportItem): number => {
  const commitCount = hotspot.commitCount ?? 0;
  if (commitCount >= 40) {
    return 1;
  }
  if (commitCount >= 18) {
    return 2;
  }
  if (commitCount >= 8) {
    return 3;
  }
  return 4;
};

const actionLabel = (hotspot: HotspotReportItem): string =>
  hotspot.suggestedActions[0] || hotspot.biggestLevers[0] || "Review hotspot";

const hotspotData = (hotspot: HotspotReportItem) => {
  const topFactor = hotspot.topFactors[0];
  const secondFactor = hotspot.topFactors[1];

  return {
    chip: factorChip(topFactor),
    icon: hotspotIcon(topFactor),
    iconClassName: hotspotIconClassName(topFactor),
    score: Math.round(hotspot.score),
    scoreRingClassName: scoreRingClassName(hotspot.score),
    summary:
      secondFactor === undefined
        ? hotspot.reason
        : `${topFactor?.label ?? "Risk concentration"} + ${secondFactor.label}.`,
    volatility: percentFromContribution(hotspot.riskContributions.evolution),
    owners: ownerEstimate(hotspot),
    action: actionLabel(hotspot),
  };
};

const distributionLabel = (value: string): string =>
  value
    .split("/")
    .filter(Boolean)
    .slice(-2)
    .join(" / ")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (segment) => segment.toUpperCase()) || "Core";

const distributionEntries = (report: CodeSentinelReport) => {
  const moduleMap = new Map<
    string,
    { score: number; external: number; count: number; label: string }
  >();

  for (const hotspot of report.hotspots.slice(0, 6)) {
    const label = distributionLabel(hotspot.module || hotspot.target);
    const current = moduleMap.get(label);
    if (current === undefined) {
      moduleMap.set(label, {
        score: hotspot.normalizedScore,
        external: hotspot.riskContributions.external,
        count: 1,
        label,
      });
      continue;
    }

    current.score += hotspot.normalizedScore;
    current.external += hotspot.riskContributions.external;
    current.count += 1;
  }

  return [...moduleMap.values()]
    .map((entry) => ({
      label: entry.label,
      baseHeight: `${Math.max(30, Math.min(100, Math.round((entry.score / entry.count) * 100)))}%`,
      overlayHeight: `${Math.max(12, Math.min(85, Math.round((entry.external / entry.count) * 100)))}%`,
    }))
    .slice(0, 6);
};

const insightItems = (report: CodeSentinelReport) => {
  const first = report.hotspots[0];
  const second = report.health.topIssues.find(
    (issue) => issue.dimension === "ownershipDistribution",
  );

  return [
    {
      index: "01",
      title: "High Churn + Centrality",
      copy:
        first === undefined
          ? "Central hotspots should be the first refactoring target because they absorb outsized delivery pressure."
          : `${first.target} combines elevated churn with structural centrality, making it a likely release bottleneck.`,
    },
    {
      index: "02",
      title: "Ownership Concentration",
      copy:
        second?.message ??
        "Single-author hotspots reduce change resilience and increase regression risk during handoffs.",
    },
  ];
};

const comparisonStats = (hotspot: HotspotReportItem) => [
  {
    label: "Risk Score",
    value: `${Math.round(hotspot.score)}`,
  },
  {
    label: "Commits",
    value: `${hotspot.commitCount ?? 0}`,
  },
  {
    label: "Churn",
    value: `${hotspot.churnTotal ?? 0}`,
  },
  {
    label: "Top Factor",
    value: hotspot.topFactors[0]?.label ?? "No factor",
  },
];

export const HotspotsScreen = ({ report }: HotspotsScreenProps) => {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const topHotspots = report.hotspots.slice(0, 10);
  const visibleHotspots = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase();
    if (normalized === "") {
      return topHotspots;
    }

    return topHotspots.filter(
      (hotspot) =>
        hotspot.target.toLowerCase().includes(normalized) ||
        hotspot.module.toLowerCase().includes(normalized),
    );
  }, [deferredQuery, topHotspots]);
  const [comparisonLeftTarget, setComparisonLeftTarget] = useState("");
  const [comparisonRightTarget, setComparisonRightTarget] = useState("");
  const comparisonLeft = topHotspots.find((hotspot) => hotspot.target === comparisonLeftTarget);
  const comparisonRight = topHotspots.find((hotspot) => hotspot.target === comparisonRightTarget);
  const distribution = distributionEntries(report);
  const insights = insightItems(report);

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-surface p-4 md:p-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-12">
        <section className="flex max-w-4xl flex-col gap-2">
          <LabelSm as="span" className="text-tertiary">
            Triage Command Center
          </LabelSm>
          <h1 className="text-2xl font-semibold tracking-tight text-on-surface md:text-3xl">
            Hotspots &amp; Priority Risk
          </h1>
          <BodyMd className="max-w-2xl text-sm md:text-base">
            Visualizing technical debt through the lens of behavioral metrics. Identify high-churn,
            low-resilience modules that threaten release stability.
          </BodyMd>
        </section>

        <section className="grid grid-cols-12 items-start gap-4 md:gap-8">
          <SurfacePanel className="col-span-12 flex flex-col justify-between gap-6 border border-outline-variant/10 p-6 lg:col-span-4">
            <div>
              <TitleMd as="h3" className="mb-2">
                Drill-Down Comparison
              </TitleMd>
              <BodyMd className="mb-6">
                Select two modules to compare their volatility and ownership concentration
                side-by-side.
              </BodyMd>
            </div>

            <div className="flex flex-col gap-3">
              <label className="block">
                <span className="mb-2 block text-[0.6875rem] font-bold uppercase tracking-wider text-on-surface-variant">
                  Primary Target
                </span>
                <select
                  className="w-full rounded-lg border border-outline-variant/10 bg-surface-container-lowest px-3 py-3 text-[0.875rem] text-on-surface outline-none focus:ring-1 focus:ring-primary"
                  onChange={(event) => setComparisonLeftTarget(event.target.value)}
                  value={comparisonLeftTarget}
                >
                  <option value="">Select target</option>
                  {topHotspots.map((hotspot) => (
                    <option key={hotspot.target} value={hotspot.target}>
                      {hotspot.target}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-[0.6875rem] font-bold uppercase tracking-wider text-on-surface-variant">
                  Comparison Target
                </span>
                <select
                  className="w-full rounded-lg border border-outline-variant/10 bg-surface-container-lowest px-3 py-3 text-[0.875rem] text-on-surface outline-none focus:ring-1 focus:ring-primary"
                  onChange={(event) => setComparisonRightTarget(event.target.value)}
                  value={comparisonRightTarget}
                >
                  <option value="">Select target</option>
                  {topHotspots.map((hotspot) => (
                    <option key={hotspot.target} value={hotspot.target}>
                      {hotspot.target}
                    </option>
                  ))}
                </select>
              </label>

              {comparisonLeft !== undefined && comparisonRight !== undefined ? (
                <SurfaceCard className="mt-2 rounded-lg border border-outline-variant/10 p-4 shadow-none">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-on-surface-variant">
                      Current Comparison
                    </span>
                    <span className="text-[0.75rem] font-semibold text-tertiary">
                      {Math.round(comparisonLeft.score - comparisonRight.score) === 0
                        ? "Balanced profile"
                        : Math.round(comparisonLeft.score - comparisonRight.score) > 0
                          ? `${comparisonLeft.module || comparisonLeft.target} carries more risk`
                          : `${comparisonRight.module || comparisonRight.target} carries more risk`}
                    </span>
                  </div>

                  <div className="overflow-x-auto pb-1">
                    <table className="min-w-[34rem] table-fixed border-separate border-spacing-x-3 border-spacing-y-0">
                      <thead>
                        <tr className="align-top">
                          <th className="w-20 pb-4 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-on-surface-variant">
                            &nbsp;
                          </th>
                          {[comparisonLeft, comparisonRight].map((hotspot) => (
                            <th
                              className="pb-4 text-left align-top text-[0.8125rem] font-semibold text-on-surface"
                              key={`${hotspot.target}-header`}
                            >
                              <div className="min-h-[5rem] break-words leading-snug [overflow-wrap:anywhere]">
                                {hotspot.target}
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {comparisonStats(comparisonLeft).map((entry, index) => (
                          <tr className="align-top text-[0.75rem]" key={entry.label}>
                            <td className="py-1.5 text-on-surface-variant">{entry.label}</td>
                            <td className="py-1.5 pr-1 font-semibold text-on-surface">
                              {entry.value}
                            </td>
                            <td className="py-1.5 pr-1 font-semibold text-on-surface">
                              {comparisonStats(comparisonRight)[index]?.value}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SurfaceCard>
              ) : null}
            </div>
          </SurfacePanel>

          <SurfaceCard className="relative col-span-12 overflow-hidden rounded-xl p-6 md:p-8 lg:col-span-8">
            <div className="mb-8 flex items-start justify-between">
              <div>
                <TitleMd as="h3" className="mb-1">
                  Risk Distribution
                </TitleMd>
                <BodyMd>Hotspot concentration across core architectural layers.</BodyMd>
              </div>
              {/* Reserved for a future real CORE/LIBS legend once the chart is backed by
                  an explicit classification rule instead of inferred module grouping. */}
            </div>

            <div className="mx-auto max-w-4xl px-1 md:px-4">
              <div className="flex h-48 w-full items-end gap-2 md:gap-4">
                {distribution.map((entry) => (
                  <div className="flex h-full flex-1 flex-col justify-end" key={entry.label}>
                    <div
                      className="relative w-full rounded-t-lg bg-surface-container-low"
                      style={{ height: entry.baseHeight }}
                    >
                      <div
                        className="absolute bottom-0 w-full rounded-t-lg bg-error-container/20"
                        style={{ height: entry.overlayHeight }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-between gap-2 px-1 text-[0.625rem] font-bold uppercase tracking-wider text-on-surface-variant md:px-4 md:text-xs">
                {distribution.map((entry) => (
                  <span
                    className="min-w-0 flex-1 break-words text-center [overflow-wrap:anywhere]"
                    key={`${entry.label}-label`}
                  >
                    {entry.label}
                  </span>
                ))}
              </div>
            </div>
          </SurfaceCard>
        </section>

        <section className="overflow-hidden rounded-xl bg-surface-container-lowest">
          <div className="flex items-center justify-between border-b border-outline-variant/10 px-8 py-6 max-md:flex-col max-md:items-start max-md:gap-4 max-md:px-4">
            <SectionHeader />
            <div className="flex gap-4">
              <div className="flex items-center gap-2 rounded-full bg-surface-container-low px-4 py-2 text-[0.875rem] text-on-surface-variant">
                <MaterialSymbol className="text-[1rem]" icon="sort" />
                Ranked by Risk Score
              </div>
            </div>
          </div>

          <div className="border-b border-outline-variant/10 px-8 py-4 max-md:px-4">
            <label className="relative block max-w-sm">
              <MaterialSymbol
                className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-on-surface-variant"
                icon="search"
              />
              <input
                className="w-full rounded-lg bg-surface-container-low py-2 pl-10 pr-4 text-[0.875rem] text-on-surface outline-none ring-0 placeholder:text-on-surface-variant focus:ring-1 focus:ring-primary"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search hotspots..."
                type="text"
                value={query}
              />
            </label>
          </div>

          <div className="overflow-visible md:overflow-x-auto">
            <div className="min-w-0 md:min-w-[68rem]">
              <div className="hidden grid-cols-12 bg-surface-container-low px-8 py-4 text-[0.6875rem] font-bold uppercase tracking-wider text-on-surface-variant md:grid">
                <div className="col-span-5">File Path / Module</div>
                <div className="col-span-1 text-center">Score</div>
                <div className="col-span-2">Risk Factor</div>
                <div className="col-span-2">Metrics Snapshot</div>
                <div className="col-span-2 text-right">Suggested Action</div>
              </div>

              <div>
                {visibleHotspots.map((hotspot, index) => {
                  const data = hotspotData(hotspot);
                  return (
                    <div
                      className={cn(
                        "flex flex-col gap-6 px-4 py-8 transition-colors hover:bg-surface-container-low/50 md:grid md:grid-cols-12 md:items-center md:gap-x-4 md:px-8",
                        index < visibleHotspots.length - 1
                          ? "border-b border-outline-variant/5"
                          : "",
                      )}
                      key={hotspot.target}
                    >
                      <div className="col-span-5 flex items-center gap-4">
                        <div
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                            data.iconClassName,
                          )}
                        >
                          <MaterialSymbol icon={data.icon} />
                        </div>
                        <div className="min-w-0">
                          <p className="break-words text-sm font-semibold text-on-surface md:text-base [overflow-wrap:anywhere]">
                            {hotspot.target}
                          </p>
                          <p className="text-[0.875rem] text-on-surface-variant">
                            {moduleLabel(hotspot)}
                          </p>
                        </div>
                      </div>

                      <div className="col-span-1 flex md:justify-center">
                        <div className="flex items-center gap-2 md:block">
                          <span className="mr-2 text-xs font-bold uppercase tracking-widest text-on-surface-variant md:hidden">
                            Score:
                          </span>
                          <div
                            className={cn(
                              "flex h-10 w-10 items-center justify-center rounded-full border-2 md:h-12 md:w-12 md:border-4",
                              data.scoreRingClassName,
                            )}
                          >
                            <span className="text-sm font-bold md:text-base">{data.score}</span>
                          </div>
                        </div>
                      </div>

                      <div className="col-span-2 min-w-0">
                        <div className="flex items-center gap-2 md:block">
                          <span className="mr-2 shrink-0 text-xs font-bold uppercase tracking-widest text-on-surface-variant md:hidden">
                            Risk:
                          </span>
                          <div>
                            <span
                              className={cn(
                                "mb-1 inline-block rounded px-2 py-0.5 text-[0.625rem] font-bold md:px-2 md:py-1 md:text-[0.6875rem]",
                                data.chip.className,
                              )}
                            >
                              {data.chip.label}
                            </span>
                            <p className="break-words text-[0.6875rem] text-on-surface-variant md:text-[0.75rem] [overflow-wrap:anywhere]">
                              {data.summary}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="col-span-2 grid grid-cols-2 gap-4 md:pr-4">
                        <div className="flex flex-col">
                          <span className="mb-1 text-[0.625rem] font-bold uppercase tracking-widest text-on-surface-variant md:text-[0.6875rem]">
                            Volatility
                          </span>
                          <div className="flex items-center gap-2">
                            <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-container-high">
                              <div
                                className={cn(
                                  "h-full",
                                  data.volatility >= 70 ? "bg-error" : "bg-tertiary",
                                )}
                                style={{ width: `${data.volatility}%` }}
                              />
                            </div>
                            <span className="text-[0.6875rem] font-bold">{data.volatility}%</span>
                          </div>
                        </div>
                        <div className="flex flex-col">
                          <span className="mb-1 text-[0.625rem] font-bold uppercase tracking-widest text-on-surface-variant md:text-[0.6875rem]">
                            Owners
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-on-surface md:text-base">
                              {data.owners}
                            </span>
                            <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-on-surface-variant">
                              {data.owners === 1 ? "Author" : "Authors"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="col-span-2 min-w-0 md:text-right">
                        <button
                          className="max-w-full whitespace-normal text-xs font-semibold text-tertiary hover:underline md:text-[0.8125rem]"
                          type="button"
                        >
                          {data.action}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <SurfaceCard className="relative z-10 mx-auto -mt-6 max-w-2xl rounded-2xl border border-outline-variant/10 bg-surface-container-lowest/80 p-8 shadow-2xl backdrop-blur-xl">
          <div className="mb-6 flex items-center gap-4">
            <div className="rounded-lg bg-primary-container p-2">
              <MaterialSymbol className="text-primary" icon="lightbulb" />
            </div>
            <TitleMd as="h4" className="font-bold">
              Heuristic Insights
            </TitleMd>
          </div>
          <div className="space-y-6">
            {insights.map((insight) => (
              <div className="flex gap-4" key={insight.index}>
                <span className="text-[1.5rem] font-bold text-primary">{insight.index}</span>
                <div>
                  <p className="font-semibold text-on-surface">{insight.title}</p>
                  <BodyMd>{insight.copy}</BodyMd>
                </div>
              </div>
            ))}
          </div>
        </SurfaceCard>
      </div>
    </main>
  );
};

const SectionHeader = () => (
  <h3 className="text-[1.5rem] font-semibold text-on-surface">Ranked Priority Files</h3>
);
