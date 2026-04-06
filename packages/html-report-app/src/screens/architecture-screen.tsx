import type { CodeSentinelReport, StructuralCycleDetail } from "@codesentinel/reporter";
import { PageIntro } from "../components/design/page-intro";
import { QuietAction } from "../components/design/actions";
import { SurfaceCard, SurfacePanel } from "../components/design/surfaces";
import { BodyMd, BodySm, MetaLabel, TitleMd } from "../components/design/typography";
import { MaterialSymbol } from "../components/material-symbol";
import { formatScore } from "../app/report-data";
import { cn } from "../lib/utils";

type ArchitectureScreenProps = {
  report: CodeSentinelReport;
};

const compactModuleLabel = (value: string): string =>
  value
    .split("/")
    .filter(Boolean)
    .slice(-2)
    .join(" / ")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (segment) => segment.toUpperCase()) || "Repository Core";

const compactFileLabel = (value: string): string =>
  value.split("/").filter(Boolean).slice(-2).join("/");

const fragilityScore = (report: CodeSentinelReport): number =>
  Number(((report.repository.dimensionScores.structural ?? 0) / 10).toFixed(1));

const fragilityThresholdLabel = (score: number): string => {
  if (score >= 8) {
    return "High Risk Threshold";
  }
  if (score >= 5) {
    return "Watch Threshold";
  }
  return "Contained Threshold";
};

const architectureSummary = (report: CodeSentinelReport): string => {
  const topCycle = report.structural.cycleDetails[0];
  const topHub = report.structural.fanInOutExtremes.highestFanIn[0];
  const deepest = report.structural.fanInOutExtremes.deepestFiles[0];

  if (topCycle !== undefined) {
    return `An analysis of the core skeleton of your codebase. Architectural coupling is being amplified by ${topCycle.size}-node dependency loops and concentrated fan-in around ${
      topHub?.module ?? "core seams"
    }, increasing change sensitivity and deployment risk.`;
  }

  if (topHub !== undefined && deepest !== undefined) {
    return `An analysis of the core skeleton of your codebase. Architectural pressure is concentrated around ${topHub.module}, where elevated fan-in and deep structural paths around ${deepest.module} are increasing change sensitivity and maintenance friction.`;
  }

  return "An analysis of the core skeleton of your codebase. Identify tight coupling, deep nesting, and circular dependencies that impede change and increase deployment risk.";
};

const cycleSubtitle = (cycle: StructuralCycleDetail): string =>
  `${cycle.size} components involved in structural loop`;

const cycleRows = (report: CodeSentinelReport): readonly StructuralCycleDetail[] =>
  report.structural.cycleDetails.slice(0, 3);

const anatomyEntries = (report: CodeSentinelReport) => {
  const moduleMap = new Map<
    string,
    { module: string; score: number; fanIn: number; fanOut: number; depth: number }
  >();

  for (const item of report.structural.fanInOutExtremes.highestFanIn) {
    const current = moduleMap.get(item.module) ?? {
      module: item.module,
      score: 0,
      fanIn: 0,
      fanOut: 0,
      depth: 0,
    };
    current.score += item.value * 2;
    current.fanIn = Math.max(current.fanIn, item.value);
    moduleMap.set(item.module, current);
  }

  for (const item of report.structural.fanInOutExtremes.highestFanOut) {
    const current = moduleMap.get(item.module) ?? {
      module: item.module,
      score: 0,
      fanIn: 0,
      fanOut: 0,
      depth: 0,
    };
    current.score += item.value;
    current.fanOut = Math.max(current.fanOut, item.value);
    moduleMap.set(item.module, current);
  }

  for (const item of report.structural.fanInOutExtremes.deepestFiles) {
    const current = moduleMap.get(item.module) ?? {
      module: item.module,
      score: 0,
      fanIn: 0,
      fanOut: 0,
      depth: 0,
    };
    current.score += item.value * 1.5;
    current.depth = Math.max(current.depth, item.value);
    moduleMap.set(item.module, current);
  }

  const maxScore = Math.max(1, ...[...moduleMap.values()].map((entry) => entry.score));

  return [...moduleMap.values()]
    .sort((a, b) => b.score - a.score || a.module.localeCompare(b.module))
    .slice(0, 5)
    .map((entry, index) => ({
      key: entry.module,
      label: compactModuleLabel(entry.module).toUpperCase(),
      scoreLabel: `${Math.round(entry.score)} Pressure`,
      intensity: entry.score / maxScore,
      tone: index === 0 || entry.fanIn >= 20 ? "fragile" : entry.depth >= 12 ? "watch" : "stable",
    }));
};

const anatomyStats = (report: CodeSentinelReport) => {
  const metrics = report.structural.metrics;

  return [
    {
      label: "System Coupling",
      value: `${Math.round(metrics.couplingDensity)}%`,
    },
    { label: "Cross-Refs", value: `${metrics.edgeCount}` },
    { label: "Entry Points", value: `${metrics.entryPointCount}` },
  ] as const;
};

type ChokepointRow = {
  file: string;
  module: string;
  fanIn: number | null;
  fanOut: number | null;
  volatility: number | null;
  impact: string;
};

const chokepointRows = (report: CodeSentinelReport): readonly ChokepointRow[] => {
  const hotspotByTarget = new Map(
    report.hotspots.map((hotspot) => [hotspot.target, hotspot] as const),
  );
  const rowMap = new Map<string, ChokepointRow>();

  for (const entry of report.structural.fanInOutExtremes.highestFanIn) {
    rowMap.set(entry.file, {
      file: entry.file,
      module: entry.module,
      fanIn: entry.value,
      fanOut:
        report.structural.fanInOutExtremes.highestFanOut.find(
          (candidate) => candidate.file === entry.file,
        )?.value ?? null,
      volatility: hotspotByTarget.get(entry.file)?.recentVolatility ?? null,
      impact: entry.value >= 20 ? "Critical" : entry.value >= 10 ? "Moderate" : "Observed",
    });
  }

  for (const entry of report.structural.fanInOutExtremes.highestFanOut) {
    const current = rowMap.get(entry.file);
    if (current !== undefined) {
      current.fanOut = entry.value;
      continue;
    }

    rowMap.set(entry.file, {
      file: entry.file,
      module: entry.module,
      fanIn:
        report.structural.fanInOutExtremes.highestFanIn.find(
          (candidate) => candidate.file === entry.file,
        )?.value ?? null,
      fanOut: entry.value,
      volatility: hotspotByTarget.get(entry.file)?.recentVolatility ?? null,
      impact: entry.value >= 20 ? "Expansive" : "Distributed",
    });
  }

  return [...rowMap.values()]
    .sort(
      (a, b) =>
        (b.fanIn ?? 0) - (a.fanIn ?? 0) ||
        (b.fanOut ?? 0) - (a.fanOut ?? 0) ||
        a.file.localeCompare(b.file),
    )
    .slice(0, 5);
};

const impactTone = (impact: string): string => {
  if (impact === "Critical") {
    return "text-error";
  }
  if (impact === "Moderate" || impact === "Expansive") {
    return "text-on-surface";
  }
  return "text-on-surface-variant";
};

const volatilityLabel = (value: number | null): { label: string; className: string } => {
  if (value === null) {
    return {
      label: "Unknown",
      className: "text-on-surface-variant bg-surface-container-high",
    };
  }

  const percent = Math.round(value * 100);
  if (percent >= 70) {
    return { label: "High", className: "text-on-error-container bg-error-container/20" };
  }
  if (percent >= 40) {
    return { label: "Medium", className: "text-tertiary bg-tertiary-container/20" };
  }
  return { label: "Low", className: "text-on-surface-variant bg-surface-container-high" };
};

const depthEntries = (report: CodeSentinelReport) => {
  const rows = report.structural.fanInOutExtremes.deepestFiles.slice(0, 2);
  const maxDepth = Math.max(1, ...rows.map((entry) => entry.value));

  return rows.map((entry) => ({
    file: entry.file,
    value: entry.value,
    width: `${Math.max(20, Math.round((entry.value / maxDepth) * 100))}%`,
    className: entry.value >= 16 ? "bg-error" : "bg-tertiary",
  }));
};

const structuralHint = (report: CodeSentinelReport): string => {
  const cycle = report.structural.cycleDetails[0];
  const cluster = report.structural.fragileClusters[0];

  if (cycle !== undefined) {
    const nodes = cycle.nodes
      .map((node) => compactFileLabel(node))
      .slice(0, 3)
      .join(" -> ");
    return `${nodes} forms the most visible cycle in this snapshot. Breaking that loop would reduce coupling pressure across ${cycle.size} connected components.`;
  }

  if (cluster !== undefined) {
    const clusterLabel = cluster.id.replace(":", ": ");
    return `Cluster ${clusterLabel} groups ${cluster.files.length} tightly related files. Untangling that seam would lower the current structural fragility concentration.`;
  }

  return "Flattening the most entangled structural seam would reduce coupling pressure and improve change resilience.";
};

const clusterTone = (
  score: number,
): { icon: string; className: string; hoverClassName: string } => {
  if (score >= 0.8) {
    return {
      icon: "emergency",
      className: "bg-error-container/10 text-error",
      hoverClassName: "group-hover:text-error",
    };
  }
  if (score >= 0.5) {
    return {
      icon: "cable",
      className: "bg-tertiary-container/10 text-tertiary",
      hoverClassName: "group-hover:text-tertiary",
    };
  }
  return {
    icon: "cloud_off",
    className: "bg-primary-container/10 text-primary",
    hoverClassName: "group-hover:text-primary",
  };
};

const humanizeClusterKind = (kind: string): string =>
  kind
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const clusterTitle = (_id: string, kind: string): string => {
  if (kind === "cycle") {
    return "Circular Pressure Zone";
  }
  if (kind === "high_fan_in") {
    return "Concentrated Fan-In Core";
  }
  if (kind === "deep_nesting") {
    return "Deep Module Trench";
  }
  return `${humanizeClusterKind(kind)} Cluster`;
};

const clusterDescription = (
  cluster: CodeSentinelReport["structural"]["fragileClusters"][number],
): string =>
  `${cluster.files.length} files are grouped under ${humanizeClusterKind(cluster.kind).toLowerCase()} pressure with a structural score of ${formatScore(cluster.score)}.`;

const fileBadge = (value: string): string =>
  value.split(".").pop()?.slice(0, 3).toUpperCase() ?? "TS";

export const ArchitectureScreen = ({ report }: ArchitectureScreenProps) => {
  const score = fragilityScore(report);
  const cycles = cycleRows(report);
  const anatomy = anatomyEntries(report);
  const stats = anatomyStats(report);
  const chokepoints = chokepointRows(report);
  const depth = depthEntries(report);
  const topFanIn = report.structural.fanInOutExtremes.highestFanIn[0]?.value ?? 1;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-12 p-4 md:p-8">
      <PageIntro
        aside={
          <SurfaceCard className="border-l-4 border-error/50 p-6 shadow-sm">
            <MetaLabel as="p" className="mb-1">
              Fragility Score
            </MetaLabel>
            <p className="text-4xl font-semibold tracking-tight text-error">
              {formatScore(score)}
              <span className="text-xl opacity-50">/10</span>
            </p>
            <p className="mt-1 text-xs text-on-surface-variant">{fragilityThresholdLabel(score)}</p>
          </SurfaceCard>
        }
        description={architectureSummary(report)}
        label="Architectural Assessment"
        labelClassName="text-tertiary"
        title="Structural Fragility"
      />

      <section className="grid grid-cols-12 gap-8">
        <SurfacePanel className="col-span-12 flex flex-col p-8 lg:col-span-5">
          <div className="mb-8 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MaterialSymbol className="text-error" icon="sync_problem" />
              <TitleMd as="h3">Dependency Cycles</TitleMd>
            </div>
            <span className="rounded bg-error-container/20 px-2 py-0.5 text-[0.6875rem] font-bold text-on-error-container">
              {report.structural.cycleCount} DETECTED
            </span>
          </div>

          <div className="flex-1 space-y-4">
            {cycles.length > 0 ? (
              cycles.map((cycle, index) => (
                <SurfaceCard
                  className="group flex cursor-default items-center justify-between rounded-lg p-4 shadow-none transition-shadow hover:shadow-md"
                  key={cycle.id}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "h-2 w-2 rounded-full",
                        index === 0 ? "bg-error" : index === 1 ? "bg-error/60" : "bg-error/40",
                      )}
                    />
                    <div>
                      <p className="text-sm font-semibold text-on-surface">{cycle.path}</p>
                      <p className="text-xs text-on-surface-variant">{cycleSubtitle(cycle)}</p>
                    </div>
                  </div>
                  <MaterialSymbol
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    icon="chevron_right"
                  />
                </SurfaceCard>
              ))
            ) : (
              <SurfaceCard className="rounded-lg p-4 shadow-none">
                <BodyMd>No structural cycles were detected in this snapshot.</BodyMd>
              </SurfaceCard>
            )}
          </div>

          {/* Hidden until we build graph view. */}
          <QuietAction className="hidden mt-6 items-center gap-1" type="button">
            View Graph Analysis
            <MaterialSymbol className="text-[16px]" icon="open_in_new" />
          </QuietAction>
        </SurfacePanel>

        <SurfacePanel className="col-span-12 p-8 lg:col-span-7">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <TitleMd as="h3">Structural Anatomy</TitleMd>
              <BodySm>Visualizing module volume against concentrated structural pressure.</BodySm>
            </div>
            <div className="flex gap-2">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                <span className="h-2 w-2 rounded bg-error" /> Fragile
              </span>
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                <span className="h-2 w-2 rounded bg-tertiary" /> Stable
              </span>
            </div>
          </div>

          <div className="grid h-64 grid-cols-12 grid-rows-6 gap-2">
            {anatomy.map((entry, index) => (
              <div
                className={cn(
                  "flex flex-col justify-end rounded-lg p-3 overflow-hidden",
                  index === 0 && "col-span-6 row-span-6 p-4",
                  index === 1 && "col-span-3 row-span-4",
                  index === 2 && "col-span-3 row-span-3",
                  index === 3 && "col-span-3 row-span-3",
                  index >= 4 && "col-span-3 row-span-2",
                  entry.tone === "fragile" &&
                    "border border-error/30 bg-error/20 text-on-error-container",
                  entry.tone === "watch" && "border border-error/20 bg-error/10 text-error",
                  entry.tone === "stable" &&
                    "border border-tertiary/20 bg-tertiary/10 text-on-tertiary-container",
                )}
                key={entry.key}
              >
                <span className="text-xs font-bold">{entry.label}</span>
                <span className="text-[10px] opacity-70">{entry.scoreLabel}</span>
              </div>
            ))}
          </div>

          <div className="mt-8 grid grid-cols-3 gap-6">
            {stats.map((entry) => (
              <div className="text-center" key={entry.label}>
                <p className="text-2xl font-semibold text-on-surface">{entry.value}</p>
                <p className="text-[10px] font-bold uppercase text-on-surface-variant">
                  {entry.label}
                </p>
              </div>
            ))}
          </div>
        </SurfacePanel>
      </section>

      <section className="grid grid-cols-12 gap-8">
        <SurfaceCard className="col-span-12 border border-outline-variant/10 p-8 shadow-sm lg:col-span-8">
          <TitleMd as="h3" className="mb-8">
            Architectural Chokepoints
          </TitleMd>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] border-separate border-spacing-y-4 text-left">
              <thead>
                <tr className="text-[0.6875rem] font-bold uppercase tracking-wider text-on-surface-variant">
                  <th className="pb-2">Component</th>
                  <th className="pb-2">Fan-In</th>
                  <th className="pb-2">Fan-Out</th>
                  <th className="pb-2">Volatility</th>
                  <th className="pb-2">Impact</th>
                </tr>
              </thead>
              <tbody>
                {chokepoints.map((row) => {
                  const volatility = volatilityLabel(row.volatility);
                  const fanInWidth =
                    row.fanIn === null ? 0 : Math.max(12, Math.round((row.fanIn / topFanIn) * 100));
                  return (
                    <tr
                      className="group rounded-lg transition-colors hover:bg-surface-container-low"
                      key={row.file}
                    >
                      <td className="py-4 pr-4">
                        <div className="flex items-center gap-3">
                          <MaterialSymbol className="text-tertiary" icon="account_tree" />
                          <div>
                            <p className="text-sm font-semibold text-on-surface">
                              {compactFileLabel(row.file)}
                            </p>
                            <p className="text-xs text-on-surface-variant">
                              {compactModuleLabel(row.module)}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{row.fanIn ?? "—"}</span>
                          <div className="h-1.5 w-16 rounded-full bg-surface-variant">
                            <div
                              className="h-full rounded-full bg-error"
                              style={{ width: `${fanInWidth}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="py-4">
                        <span className="text-sm text-on-surface-variant">{row.fanOut ?? "—"}</span>
                      </td>
                      <td className="py-4">
                        <span
                          className={cn(
                            "rounded px-2 py-0.5 text-[10px] font-bold uppercase",
                            volatility.className,
                          )}
                        >
                          {volatility.label}
                        </span>
                      </td>
                      <td className="py-4">
                        <span className={cn("text-sm font-bold uppercase", impactTone(row.impact))}>
                          {row.impact}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SurfaceCard>

        <div className="col-span-12 space-y-8 lg:col-span-4">
          <SurfacePanel className="p-8">
            <div className="mb-6 flex items-center gap-3">
              <MaterialSymbol className="text-secondary" icon="folder_zip" />
              <TitleMd as="h3">Cognitive Depth</TitleMd>
            </div>
            <BodySm className="mb-6">
              Files with deep directory nesting increase maintenance friction and hide core
              responsibilities.
            </BodySm>
            <div className="space-y-6">
              {depth.map((entry) => (
                <div className="flex flex-col gap-2" key={entry.file}>
                  <div className="flex justify-between gap-3 text-xs font-bold uppercase text-on-surface-variant">
                    <span className="truncate">{entry.file}</span>
                    <span className={entry.value >= 16 ? "text-error" : "text-tertiary"}>
                      {entry.value} Levels
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-surface-variant">
                    <div
                      className={cn("h-full rounded-full", entry.className)}
                      style={{ width: entry.width }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </SurfacePanel>

          <div className="relative overflow-hidden rounded-xl bg-primary p-6 text-on-primary">
            <div className="absolute -bottom-4 -right-4 opacity-10">
              <MaterialSymbol className="text-[120px]" icon="lightbulb" />
            </div>
            <h4 className="mb-2 text-lg font-semibold">Structural Refactor Hint</h4>
            <p className="text-sm leading-relaxed text-on-primary/80">{structuralHint(report)}</p>
          </div>
        </div>
      </section>

      <section className="rounded-xl bg-surface-container-low p-8">
        <div className="mb-10 flex items-center gap-3">
          <MaterialSymbol className="text-on-surface" icon="hub" />
          <h3 className="text-2xl font-semibold text-on-surface">Identified Fragile Clusters</h3>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {report.structural.fragileClusters.slice(0, 6).map((cluster) => {
            const tone = clusterTone(cluster.score);
            return (
              <SurfaceCard
                className="group rounded-lg border border-outline-variant/20 p-6 transition-all hover:border-outline-variant/40"
                key={cluster.id}
              >
                <div className="mb-4 flex items-start justify-between">
                  <span
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-md",
                      tone.className,
                    )}
                  >
                    <MaterialSymbol icon={tone.icon} />
                  </span>
                  <span className="text-[10px] font-bold text-on-surface-variant">
                    {cluster.id.toUpperCase()}
                  </span>
                </div>
                <h4
                  className={cn(
                    "text-lg font-semibold text-on-surface transition-colors",
                    tone.hoverClassName,
                  )}
                >
                  {clusterTitle(cluster.id, cluster.kind)}
                </h4>
                <p className="mb-6 mt-2 text-sm text-on-surface-variant">
                  {clusterDescription(cluster)}
                </p>
                <div className="flex -space-x-2">
                  {cluster.files.slice(0, 3).map((file) => (
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-surface bg-surface-container-high text-[10px] font-bold"
                      key={file}
                    >
                      {fileBadge(file)}
                    </div>
                  ))}
                  {cluster.files.length > 3 ? (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-surface bg-surface-container-high text-[10px] font-bold text-on-surface-variant">
                      +{cluster.files.length - 3}
                    </div>
                  ) : null}
                </div>
              </SurfaceCard>
            );
          })}
        </div>
      </section>
    </main>
  );
};
