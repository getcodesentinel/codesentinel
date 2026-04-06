import type {
  CodeSentinelReport,
  ExternalCentralityReportItem,
  RiskyDependencyReportItem,
} from "@codesentinel/reporter";
import { formatScore } from "../app/report-data";
import { PageIntro } from "../components/design/page-intro";
import { SurfaceCard, SurfacePanel } from "../components/design/surfaces";
import { BodyMd, BodySm, MetaLabel, MetricValue, TitleMd } from "../components/design/typography";
import { MaterialSymbol } from "../components/material-symbol";

type DependencyPressureScreenProps = {
  report: CodeSentinelReport;
};

const MAINTENANCE_THRESHOLD = 65;

const formatInteger = (value: number): string => new Intl.NumberFormat().format(value);

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

const formatShortDateTime = (value: string): string =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));

const dependencyScopeLabel = (dependency: RiskyDependencyReportItem): string => {
  if (dependency.dependencyScope === "prod") {
    return "Production";
  }
  if (dependency.dependencyScope === "dev") {
    return "Development";
  }
  return dependency.direct ? "Direct" : "Unknown";
};

const signalLabel = (signal: string): string =>
  signal
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const dependencyStatus = (
  dependency: RiskyDependencyReportItem,
): {
  label: string;
  chipClassName: string;
  dotClassName: string;
  detail: string;
} => {
  if (dependency.riskSignals.includes("abandoned")) {
    return {
      label: "ABANDONED",
      chipClassName: "bg-error-container/10 text-on-error-container",
      dotClassName: "bg-error",
      detail:
        dependency.daysSinceLastRelease === null
          ? "No recent release metadata"
          : `Last release ${Math.round(dependency.daysSinceLastRelease)} days ago`,
    };
  }

  if (dependency.riskSignals.includes("single_maintainer")) {
    return {
      label: "BUS FACTOR",
      chipClassName: "bg-error-container/10 text-on-error-container",
      dotClassName: "bg-error",
      detail:
        dependency.maintainerCount === null
          ? "Maintainer concentration risk"
          : `${dependency.maintainerCount} maintainer`,
    };
  }

  if (dependency.riskSignals.includes("high_fanout")) {
    return {
      label: "BLOATED",
      chipClassName: "bg-error-container/10 text-on-error-container",
      dotClassName: "bg-error",
      detail: `${dependency.fanOut} direct sub-dependencies`,
    };
  }

  if (dependency.riskSignals.includes("deep_chain")) {
    return {
      label: "DEEP CHAIN",
      chipClassName: "bg-surface-container-high text-on-surface-variant",
      dotClassName: "bg-outline",
      detail: `Dependency depth ${dependency.dependencyDepth}`,
    };
  }

  if (dependency.riskSignals.includes("high_centrality")) {
    return {
      label: "CENTRAL",
      chipClassName: "bg-surface-container-high text-on-surface-variant",
      dotClassName: "bg-outline",
      detail: `${dependency.dependentCount} internal dependents`,
    };
  }

  return {
    label: "WATCH",
    chipClassName: "bg-surface-container-high text-on-surface-variant",
    dotClassName: "bg-outline",
    detail: dependency.reason,
  };
};

const pressureTrend = (
  report: CodeSentinelReport,
): {
  delta: number;
  directionIcon: "trending_up" | "trending_down";
  label: string;
} | null => {
  const externalDelta = report.diff?.externalDimensionDelta;
  const baselineGeneratedAt = report.diff?.baselineGeneratedAt;

  if (externalDelta !== null && externalDelta !== undefined) {
    return {
      delta: Math.abs(externalDelta),
      directionIcon: externalDelta >= 0 ? "trending_up" : "trending_down",
      label:
        baselineGeneratedAt === undefined
          ? "from baseline"
          : `from ${formatShortDateTime(baselineGeneratedAt)}`,
    };
  }

  return null;
};

const heroDescription = (report: CodeSentinelReport): string => {
  if (!report.external.available) {
    return "Third-party dependency pressure is unavailable for this snapshot because external dependency analysis did not complete.";
  }

  const topDependency = report.external.riskyDependencies[0];
  const central = report.external.centralityRanking[0];

  if (topDependency !== undefined && central !== undefined) {
    return `Tracing external package pressure across the repository. Risk is concentrated around ${topDependency.name} and a dependency graph with ${formatInteger(report.external.metrics.transitiveDependencies)} transitive packages, increasing maintenance and supply-chain drag.`;
  }

  return "Tracing external package pressure across the repository. Review direct dependency risk, transitive burden, and maintainer concentration before the external surface area hardens further.";
};

const tableRows = (report: CodeSentinelReport): readonly RiskyDependencyReportItem[] =>
  report.external.available ? report.external.riskyDependencies.slice(0, 8) : [];

const criticalCount = (report: CodeSentinelReport): number => {
  if (!report.external.available) {
    return 0;
  }

  return report.external.riskyDependencies.filter(
    (dependency) =>
      dependency.score >= 70 ||
      dependency.riskSignals.includes("abandoned") ||
      dependency.riskSignals.includes("single_maintainer"),
  ).length;
};

const warningCount = (report: CodeSentinelReport): number => {
  if (!report.external.available) {
    return 0;
  }

  return Math.max(0, report.external.riskyDependencies.length - criticalCount(report));
};

const centralityLead = (entry: ExternalCentralityReportItem | undefined): string => {
  if (entry === undefined) {
    return "No centrality ranking is available for this snapshot.";
  }

  return `${entry.name} sits on ${entry.dependents} dependency paths with fan-out ${entry.fanOut}. It is the most structurally central package in the current lockfile graph.`;
};

const pressureRecommendations = (report: CodeSentinelReport) => {
  if (!report.external.available) {
    return [];
  }

  const topRisk = report.external.riskyDependencies[0];
  const mostCentral = report.external.centralityRanking[0];
  const highTransitive = [...report.external.riskyDependencies].sort(
    (a, b) =>
      b.transitiveDependencyCount - a.transitiveDependencyCount || a.name.localeCompare(b.name),
  )[0];

  return [
    topRisk === undefined
      ? null
      : {
          key: "top-risk",
          icon: "warning",
          iconClassName: "bg-on-surface text-surface",
          title: `Audit ${topRisk.name} first`,
          copy: `${topRisk.name} is the highest-risk dependency in this snapshot with ${formatScore(topRisk.score)} risk score and ${topRisk.riskSignals.length} flagged signals.`,
          className: "bg-surface-container-low",
          textClassName: "text-on-surface-variant",
        },
    mostCentral === undefined
      ? null
      : {
          key: "centrality",
          icon: "account_tree",
          iconClassName: "bg-tertiary text-on-tertiary",
          title: "Reduce central package load",
          copy: centralityLead(mostCentral),
          className: "border border-tertiary-container/20 bg-tertiary-container/10",
          textClassName: "text-on-tertiary-container/80",
        },
    highTransitive === undefined
      ? null
      : {
          key: "transitive",
          icon: "layers",
          iconClassName: "bg-primary text-on-primary",
          title: "Target transitive burden",
          copy: `${highTransitive.name} pulls in ${formatInteger(highTransitive.transitiveDependencyCount)} transitive packages, making it the heaviest single entry in the current risk table.`,
          className: "bg-surface-container-low",
          textClassName: "text-on-surface-variant",
        },
  ].filter((item): item is NonNullable<typeof item> => item !== null);
};

export const DependencyPressureScreen = ({ report }: DependencyPressureScreenProps) => {
  if (!report.external.available) {
    return (
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-12 p-4 md:p-8">
        <PageIntro
          description={heroDescription(report)}
          label="External Surface"
          labelClassName="text-tertiary"
          title="Dependency Pressure"
        />

        <SurfaceCard className="max-w-3xl p-8">
          <TitleMd as="h3" className="mb-3">
            External analysis unavailable
          </TitleMd>
          <BodyMd>
            {report.external.reason === "package_json_not_found"
              ? "No package manifest was found, so dependency analysis could not run."
              : report.external.reason === "lockfile_not_found"
                ? "A supported lockfile was not found, so transitive dependency pressure could not be calculated."
                : report.external.reason === "unsupported_lockfile_format"
                  ? "The repository uses a lockfile format that is not currently supported by CodeSentinel."
                  : "The dependency snapshot could not be parsed into a deterministic external analysis."}
          </BodyMd>
        </SurfaceCard>
      </main>
    );
  }

  const rows = tableRows(report);
  const recommendations = pressureRecommendations(report);
  const externalScore = report.repository.dimensionScores.external;
  const trend = pressureTrend(report);
  const thresholdPercent = clampPercent(MAINTENANCE_THRESHOLD);
  const directDependencyTotal = Math.max(0, report.external.metrics.directDependencies);
  const productionPercent =
    directDependencyTotal === 0
      ? 0
      : clampPercent(
          (report.external.metrics.directProductionDependencies / directDependencyTotal) * 100,
        );
  const developmentPercent =
    directDependencyTotal === 0
      ? 0
      : clampPercent(
          (report.external.metrics.directDevelopmentDependencies / directDependencyTotal) * 100,
        );

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-12 p-4 md:p-8">
      <PageIntro
        description={heroDescription(report)}
        label="External Surface"
        labelClassName="text-tertiary"
        title="Dependency Pressure"
      />

      <section className="grid grid-cols-12 gap-6">
        <SurfacePanel className="col-span-12 flex flex-col justify-between gap-8 border-0 p-6 lg:col-span-4">
          <div>
            <MetaLabel>Total Pressure Index</MetaLabel>
            <div className="mt-2">
              <MetricValue as="div" className="text-[3.5rem] leading-none tracking-[-0.02em]">
                {formatScore(externalScore)}
              </MetricValue>
              {trend === null ? null : (
                <div className="mt-3 flex items-center gap-1 text-sm font-medium text-error">
                  <MaterialSymbol className="text-sm" icon={trend.directionIcon} />
                  <span>
                    {trend.delta.toFixed(1)}% {trend.label}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-xs font-medium">
              <span className="text-on-surface-variant">Maintenance Threshold</span>
              <span className="text-on-surface">{MAINTENANCE_THRESHOLD.toFixed(1)}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
              <div
                className="h-full rounded-full bg-error"
                style={{ width: `${thresholdPercent}%` }}
              />
            </div>
          </div>
        </SurfacePanel>

        <div className="col-span-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:col-span-8">
          <SurfaceCard className="border border-outline-variant/10 p-6 shadow-none">
            <div className="mb-4 flex items-start justify-between">
              <MetaLabel>Dependency Split</MetaLabel>
              <MaterialSymbol className="text-on-surface-variant/40" icon="pie_chart" />
            </div>
            <div className="mt-6 flex items-end gap-12">
              <div className="space-y-1">
                <MetricValue as="div" className="text-3xl">
                  {formatInteger(report.external.metrics.directProductionDependencies)}
                </MetricValue>
                <BodySm>Production</BodySm>
              </div>
              <div className="space-y-1">
                <MetricValue as="div" className="text-3xl text-primary">
                  {formatInteger(report.external.metrics.directDevelopmentDependencies)}
                </MetricValue>
                <BodySm>Development</BodySm>
              </div>
            </div>
            <div className="mt-8 flex h-2 gap-1 overflow-hidden rounded-full">
              <div
                className="bg-on-surface"
                style={{
                  width: `${productionPercent}%`,
                }}
              />
              <div
                className="bg-primary"
                style={{
                  width: `${developmentPercent}%`,
                }}
              />
            </div>
          </SurfaceCard>

          <SurfaceCard className="border border-outline-variant/10 p-6 shadow-none">
            <div className="mb-4 flex items-start justify-between">
              <MetaLabel>Transitive Burden</MetaLabel>
              <MaterialSymbol className="text-on-surface-variant/40" icon="account_tree" />
            </div>
            <div className="mt-6 flex min-h-24 flex-col justify-center text-center">
              <MetricValue as="div" className="text-3xl">
                {formatInteger(report.external.metrics.transitiveDependencies)}
              </MetricValue>
              <BodySm>Indirect sub-dependencies</BodySm>
            </div>
            <div className="mt-6 flex items-center justify-between text-xs text-on-surface-variant">
              <span>Direct: {formatInteger(report.external.metrics.directDependencies)}</span>
              <span>Depth: {report.external.metrics.dependencyDepth}</span>
            </div>
          </SurfaceCard>
        </div>
      </section>

      <section className="space-y-8">
        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <TitleMd as="h3">High-Pressure Risk Profile</TitleMd>
            <div className="flex gap-2">
              <span className="rounded-full bg-error-container/20 px-3 py-1 text-[0.6875rem] font-bold text-on-error-container">
                {criticalCount(report)} CRITICAL
              </span>
              <span className="rounded-full bg-surface-container-high px-3 py-1 text-[0.6875rem] font-bold text-on-surface-variant">
                {warningCount(report)} WARNING
              </span>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-outline-variant/10 bg-surface-container-lowest">
            <table className="min-w-[48rem] w-full border-collapse text-left">
              <thead>
                <tr className="bg-surface-container-low">
                  <th className="px-6 py-4 text-[0.6875rem] font-bold uppercase tracking-widest text-on-surface-variant">
                    Package &amp; Version
                  </th>
                  <th className="px-6 py-4 text-[0.6875rem] font-bold uppercase tracking-widest text-on-surface-variant">
                    Risk Factor
                  </th>
                  <th className="px-6 py-4 text-right text-[0.6875rem] font-bold uppercase tracking-widest text-on-surface-variant">
                    Burden
                  </th>
                  <th className="px-6 py-4 text-center text-[0.6875rem] font-bold uppercase tracking-widest text-on-surface-variant">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((dependency) => {
                  const status = dependencyStatus(dependency);
                  return (
                    <tr
                      className="border-t border-outline-variant/10 transition-colors hover:bg-surface-container-low"
                      key={dependency.name}
                    >
                      <td className="px-6 py-5 align-top">
                        <div className="font-medium text-on-surface">{dependency.name}</div>
                        <div className="text-xs text-on-surface-variant">
                          {dependency.resolvedVersion === null
                            ? "version unknown"
                            : `v${dependency.resolvedVersion}`}{" "}
                          • {dependencyScopeLabel(dependency)}
                        </div>
                      </td>
                      <td className="px-6 py-5 align-top">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${status.dotClassName}`} />
                          <span className="text-sm text-on-surface">{status.detail}</span>
                        </div>
                        <div className="mt-2 text-xs text-on-surface-variant">
                          {(dependency.riskSignals.length > 0
                            ? dependency.riskSignals
                            : ["metadata_unavailable"]
                          )
                            .slice(0, 2)
                            .map(signalLabel)
                            .join(" · ")}
                        </div>
                      </td>
                      <td className="px-6 py-5 text-right align-top font-medium text-on-surface">
                        {formatInteger(dependency.transitiveDependencyCount)} sub-deps
                      </td>
                      <td className="px-6 py-5 text-center align-top">
                        <span
                          className={`inline-flex rounded px-2.5 py-1 text-[0.6875rem] font-bold ${status.chipClassName}`}
                        >
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <TitleMd as="h3">Remediation Intelligence</TitleMd>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {recommendations.map((item) => (
              <SurfacePanel className={`space-y-4 border-0 p-5 ${item.className}`} key={item.key}>
                <div className="flex items-start gap-4">
                  <div
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${item.iconClassName}`}
                  >
                    <MaterialSymbol icon={item.icon} />
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-on-surface">{item.title}</div>
                    <div className={`text-xs leading-relaxed ${item.textClassName}`}>
                      {item.copy}
                    </div>
                  </div>
                </div>
              </SurfacePanel>
            ))}
            {/*
              <SurfaceCard className="overflow-hidden shadow-none xl:col-span-3">
                <div className="relative min-h-48 bg-[radial-gradient(circle_at_top_left,_rgba(80,149,254,0.22),_transparent_45%),linear-gradient(180deg,_rgba(45,51,56,0.04),_rgba(45,51,56,0.78))] p-6">
                  <div className="flex h-full flex-col justify-end">
                    <MetaLabel className="mb-1 text-surface/80">Graph Analysis</MetaLabel>
                    <div className="text-lg font-semibold leading-tight text-surface">
                      Map {formatInteger(report.external.metrics.totalDependencies)} packages across
                      the current lockfile
                    </div>
                    <div className="mt-3 text-xs font-medium text-surface/90">
                      {report.external.metrics.lockfileKind} lockfile •{" "}
                      {report.external.centralityRanking.length} ranked central dependencies
                    </div>
                    <a
                      className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-surface transition-opacity hover:opacity-85"
                      href="#"
                    >
                      Launch Visualizer
                      <MaterialSymbol className="text-sm" icon="north_east" />
                    </a>
                  </div>
                </div>
              </SurfaceCard>
            */}
          </div>
        </div>
      </section>
    </main>
  );
};
