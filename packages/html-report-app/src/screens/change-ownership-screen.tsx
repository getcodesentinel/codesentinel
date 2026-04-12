import { useState } from "react";
import type {
  ChangeOwnershipMetrics,
  CodeSentinelReport,
  CoChangePairReportItem,
  FileOwnershipReportItem,
  HotspotReportItem,
  ModuleKnowledgeReportItem,
  OwnershipContributorReportItem,
  OwnershipPostureReportItem,
  OwnershipRiskAreaReportItem,
  RecentActivityReportItem,
} from "@codesentinel/reporter";
import { HoverTooltipPortal, useHoverTooltip } from "../components/design/hover-tooltip";
import { PageIntro } from "../components/design/page-intro";
import {
  ReportTable,
  ReportTableCell,
  ReportTableFrame,
  ReportTableHeaderCell,
  ReportTableRow,
} from "../components/design/report-table";
import { SurfaceCard, SurfacePanel } from "../components/design/surfaces";
import { BodyMd, MetaLabel, TitleMd } from "../components/design/typography";
import { MaterialSymbol } from "../components/material-symbol";
import { cn } from "../lib/utils";

type ChangeOwnershipScreenProps = {
  report: CodeSentinelReport;
};

type OwnershipMetricMode = "commits" | "churn";

const COLLAPSED_FILE_OWNERSHIP_CONTRIBUTOR_LIMIT = 3;

const formatPercent = (value: number | null | undefined): string => {
  if (value === null || value === undefined) {
    return "n/a";
  }

  if (value > 0 && value < 1) {
    return "<1%";
  }

  return `${Math.round(value)}%`;
};

const formatSharePercent = (value: number): string => `${Math.round(value * 100)}%`;

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
  module: ModuleKnowledgeReportItem,
): { className: string; textClassName: string; icon?: string; meta?: string } => {
  if (module.ownershipLabel === "distributed") {
    if (module.activeAuthors >= 5 && module.topAuthorShareByCommits <= 0.4) {
      return {
        className: "bg-tertiary",
        textClassName: "text-on-primary",
        icon: "check_circle",
      };
    }

    return {
      className: "bg-tertiary/70",
      textClassName: "text-on-primary",
      meta: `${module.activeAuthors} Active Devs`,
    };
  }

  if (module.ownershipLabel === "sparse") {
    return {
      className: "bg-tertiary/40",
      textClassName: "text-on-surface",
      meta: "Sparse",
    };
  }

  return {
    className:
      module.topAuthorShareByCommits >= 0.95
        ? "border border-error/40 bg-error/25"
        : "border border-error/30 bg-error/20",
    textClassName: "text-error",
    icon: "warning",
  };
};

const postureMeta = (
  posture: OwnershipPostureReportItem,
): { chipClassName: string; accentClassName: string; icon: string } => {
  switch (posture.status) {
    case "balanced":
      return {
        chipClassName: "bg-tertiary/12 text-tertiary",
        accentClassName: "text-tertiary",
        icon: "check_circle",
      };
    case "concentrated":
      return {
        chipClassName: "bg-surface-container-high text-on-surface-variant",
        accentClassName: "text-secondary",
        icon: "hub",
      };
    case "stale":
      return {
        chipClassName: "bg-surface-container-high text-on-surface-variant",
        accentClassName: "text-secondary",
        icon: "history",
      };
    case "siloed":
      return {
        chipClassName: "bg-error/10 text-error",
        accentClassName: "text-error",
        icon: "warning",
      };
  }
};

const ownershipAreaTone = (
  area: OwnershipRiskAreaReportItem,
): { chipClassName: string; textClassName: string } => {
  if (area.ownershipLabel === "siloed") {
    return {
      chipClassName: "bg-error/15 text-error",
      textClassName: "text-error",
    };
  }

  if (area.ownershipLabel === "sparse") {
    return {
      chipClassName: "bg-secondary/15 text-on-surface",
      textClassName: "text-on-surface",
    };
  }

  return {
    chipClassName: "bg-tertiary/15 text-tertiary",
    textClassName: "text-tertiary",
  };
};

const ownershipCategoryMeta = (
  label: FileOwnershipReportItem["ownershipLabel"],
): {
  title: string;
  description: string;
  icon: string;
  chipTextClassName: string;
  barClassName: string;
} => {
  switch (label) {
    case "singleMaintainer":
      return {
        title: "Single Maintainer",
        description: "Files where one contributor currently owns the commit history.",
        icon: "person_alert",
        chipTextClassName: "text-error",
        barClassName: "bg-error",
      };
    case "concentrated":
      return {
        title: "Concentrated",
        description: "Files with multiple authors, but a dominant commit owner above 60%.",
        icon: "join_inner",
        chipTextClassName: "text-on-surface",
        barClassName: "bg-secondary",
      };
    case "shared":
      return {
        title: "Shared",
        description: "Files where commit ownership is distributed across contributors.",
        icon: "groups",
        chipTextClassName: "text-tertiary",
        barClassName: "bg-tertiary",
      };
    default:
      return {
        title: "Shared",
        description: "Files where commit ownership is distributed across contributors.",
        icon: "groups",
        chipTextClassName: "text-tertiary",
        barClassName: "bg-tertiary",
      };
  }
};

const fileTitleParts = (value: string): { name: string; path: string } => {
  const parts = value.split("/").filter(Boolean);
  const name = parts.at(-1) ?? value;
  const path = parts.length <= 1 ? "root" : parts.slice(0, -1).join("/");

  return { name, path };
};

const moduleLabel = (value: string): string =>
  value
    .split("/")
    .filter(Boolean)
    .slice(-2)
    .join(" / ")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (segment) => segment.toUpperCase()) || "Root";

const formatShortDate = (value: string): string =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));

const recentActivityBars = (
  series: readonly RecentActivityReportItem[],
): readonly {
  key: string;
  height: number;
  className: string;
  point: RecentActivityReportItem;
}[] => {
  if (series.length === 0) {
    return [];
  }

  return series.map((point) => {
    const height =
      point.volatilityScore <= 0 ? 0 : Math.max(10, Math.round(point.volatilityScore * 100));
    return {
      key: point.bucketStartUtcDate,
      height,
      point,
      className:
        height >= 85
          ? "bg-error-container/40"
          : height >= 65
            ? "bg-error-container/30"
            : height >= 56
              ? "bg-tertiary/60"
              : height >= 40
                ? "bg-tertiary/40"
                : height >= 24
                  ? "bg-tertiary/25"
                  : "bg-tertiary/15",
    };
  });
};

type RecentActivityBarProps = {
  bar: ReturnType<typeof recentActivityBars>[number];
};

const RecentActivityBar = ({ bar }: RecentActivityBarProps) => {
  const { triggerProps, visible, x, y, offset } = useHoverTooltip();

  return (
    <div className="relative flex h-full w-full items-end">
      <div
        className={cn("w-full rounded-t-sm transition-opacity hover:opacity-90", bar.className)}
        {...triggerProps}
        style={{ height: `${bar.height}%` }}
      />
      <HoverTooltipPortal
        content={
          <div className="space-y-0.5 text-left">
            <div className="text-center font-medium">
              {formatShortDate(bar.point.bucketStartUtcDate)}
            </div>
            <div className="text-surface/90">
              {bar.point.commitCount} commits · {bar.point.fileTouchCount} files ·{" "}
              {bar.point.churnTotal} churn
            </div>
          </div>
        }
        offset={offset}
        visible={visible}
        x={x}
        y={y}
      />
    </div>
  );
};

type KnowledgeHeatmapTileProps = {
  module: ModuleKnowledgeReportItem;
};

const KnowledgeHeatmapTile = ({ module }: KnowledgeHeatmapTileProps) => {
  const tone = ownershipTone(module);
  const { triggerProps, visible, x, y, offset } = useHoverTooltip();

  return (
    <div
      className={cn(
        "flex flex-col justify-between rounded-lg p-3 transition-transform hover:scale-[1.02]",
        tone.className,
      )}
      key={module.module}
      {...triggerProps}
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
      <HoverTooltipPortal
        content={
          <div className="space-y-0.5 text-left">
            <div className="font-medium">{module.module}</div>
            <div className="text-surface/90">
              {module.activeAuthors} active authors · {module.recentCommits} recent commits
            </div>
            <div className="text-surface/90">
              {Math.round(module.topAuthorShareByCommits * 100)}% top-author share ·{" "}
              {module.ownershipLabel}
            </div>
          </div>
        }
        offset={offset}
        visible={visible}
        x={x}
        y={y}
      />
    </div>
  );
};

const OwnershipDistributionInfo = () => {
  const { triggerProps, visible, x, y, offset } = useHoverTooltip();

  return (
    <>
      <span
        aria-label="File ownership distribution details"
        className="inline-flex cursor-help text-primary-fixed-dim"
        role="img"
        {...triggerProps}
      >
        <MaterialSymbol className="text-primary-fixed-dim" icon="info" />
      </span>
      <HoverTooltipPortal
        className="max-w-xs px-3 py-2 leading-relaxed"
        content={
          <span>
            Files are grouped by commit ownership because repeated touches best reflect
            maintainership: shared is at or below 60% top-author share, concentrated is above 60%,
            and single maintainer has one observed contributor. Churn share helps reveal when change
            volume tells a different ownership story.
          </span>
        }
        offset={offset}
        visible={visible}
        x={x}
        y={y}
      />
    </>
  );
};

type OwnershipMetricSwitchProps = {
  value: OwnershipMetricMode;
  onChange: (value: OwnershipMetricMode) => void;
};

const ownershipMetricModes: readonly OwnershipMetricMode[] = ["commits", "churn"];

const OwnershipMetricSwitch = ({ value, onChange }: OwnershipMetricSwitchProps) => (
  <div className="relative inline-grid grid-cols-2 rounded-full bg-surface-container-low p-1 text-[0.6875rem] font-bold uppercase tracking-wider text-on-surface-variant">
    <span
      aria-hidden="true"
      className={cn(
        "absolute bottom-1 left-1 top-1 w-[calc(50%-0.25rem)] rounded-full bg-surface-container-lowest shadow-sm transition-transform duration-300 ease-out",
        value === "churn" ? "translate-x-full" : "translate-x-0",
      )}
    />
    {ownershipMetricModes.map((mode) => (
      <button
        aria-pressed={value === mode}
        className={cn(
          "relative z-10 min-w-28 rounded-full px-3 py-1.5 transition-colors duration-200",
          value === mode ? "text-on-surface" : "hover:text-on-surface",
        )}
        key={mode}
        onClick={() => onChange(mode)}
        type="button"
      >
        {mode === "commits" ? "Commit share" : "Churn share"}
      </button>
    ))}
  </div>
);

const CoChangeInfo = () => {
  const { triggerProps, visible, x, y, offset } = useHoverTooltip();

  return (
    <>
      <span
        aria-label="Co-change relationship details"
        className="inline-flex cursor-help text-primary-fixed-dim"
        role="img"
        {...triggerProps}
      >
        <MaterialSymbol className="text-primary-fixed-dim" icon="info" />
      </span>
      <HoverTooltipPortal
        className="max-w-xs px-3 py-2 leading-relaxed"
        content={
          <span>
            Files are linked when they tend to change in the same commits. Higher coupling means
            changes to one file often require reviewing the other.
          </span>
        }
        offset={offset}
        visible={visible}
        x={x}
        y={y}
      />
    </>
  );
};

const LargestContributorShareInfo = () => {
  const { triggerProps, visible, x, y, offset } = useHoverTooltip();

  return (
    <>
      <span
        aria-label="Largest contributor share details"
        className="inline-flex cursor-help text-primary-fixed-dim"
        role="img"
        {...triggerProps}
      >
        <MaterialSymbol className="text-primary-fixed-dim" icon="info" />
      </span>
      <HoverTooltipPortal
        className="max-w-xs px-3 py-2 leading-relaxed"
        content={
          <span>
            The share of repository changes owned by the single biggest contributor. Higher values
            mean more knowledge is concentrated in one person.
          </span>
        }
        offset={offset}
        visible={visible}
        x={x}
        y={y}
      />
    </>
  );
};

type FileOwnershipRowProps = {
  file: FileOwnershipReportItem;
  metricMode: OwnershipMetricMode;
};

const FileOwnershipRow = ({ file, metricMode }: FileOwnershipRowProps) => {
  const [expanded, setExpanded] = useState(false);
  const authorDistribution =
    metricMode === "commits" ? file.authorDistributionByCommits : file.authorDistributionByChurn;
  const visibleAuthors = expanded
    ? authorDistribution
    : authorDistribution.slice(0, COLLAPSED_FILE_OWNERSHIP_CONTRIBUTOR_LIMIT);
  const overflowAuthors = authorDistribution.length - visibleAuthors.length;
  const title = fileTitleParts(file.filePath);

  return (
    <article className="rounded-xl bg-surface-container-lowest p-4 shadow-sm transition-colors hover:bg-surface-container-low">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="break-words font-mono text-[0.75rem] font-semibold leading-snug text-on-surface">
            {title.name}
          </div>
          <div className="mt-1 break-words font-mono text-[0.6875rem] leading-snug text-on-surface-variant">
            {title.path}
          </div>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {visibleAuthors.map((author) => (
          <div className="min-w-0" key={author.authorId}>
            <div className="mb-1 flex items-center justify-between gap-3 text-[0.75rem]">
              <span className="truncate text-on-surface-variant">{author.authorId}</span>
              <span className="font-semibold text-on-surface">
                {formatSharePercent(author.share)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-container-high">
              <div
                className={cn(
                  "h-full rounded-full transition-[width,background-color] duration-300 ease-out",
                  metricMode === "commits" ? "bg-tertiary/70" : "bg-secondary/70",
                )}
                style={{ width: `${Math.round(author.share * 100)}%` }}
              />
            </div>
          </div>
        ))}
        {overflowAuthors > 0 ? (
          <button
            className="text-left text-[0.75rem] font-medium text-primary transition-colors hover:text-primary-fixed-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            onClick={() => setExpanded(true)}
            type="button"
          >
            +{overflowAuthors} more contributor{overflowAuthors === 1 ? "" : "s"}
          </button>
        ) : expanded && authorDistribution.length > COLLAPSED_FILE_OWNERSHIP_CONTRIBUTOR_LIMIT ? (
          <button
            className="text-left text-[0.75rem] font-medium text-primary transition-colors hover:text-primary-fixed-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            onClick={() => setExpanded(false)}
            type="button"
          >
            Show less
          </button>
        ) : null}
      </div>
    </article>
  );
};

type FileOwnershipGroupProps = {
  label: FileOwnershipReportItem["ownershipLabel"];
  files: readonly FileOwnershipReportItem[];
  metricMode: OwnershipMetricMode;
  totalFiles: number;
};

const FileOwnershipGroup = ({ label, files, metricMode, totalFiles }: FileOwnershipGroupProps) => {
  const meta = ownershipCategoryMeta(label);
  const categoryShare = totalFiles <= 0 ? 0 : Math.round((files.length / totalFiles) * 100);

  return (
    <SurfacePanel className="rounded-2xl p-5">
      <div className="mb-5">
        <TitleMd as="h3" className="flex items-center gap-2">
          <MaterialSymbol className="text-primary" icon={meta.icon} />
          {meta.title}
        </TitleMd>
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-on-surface-variant">
          {meta.description}
        </p>
        <div className="mt-3 text-[0.6875rem] font-semibold uppercase tracking-wider text-on-surface-variant">
          <span className={meta.chipTextClassName}>{files.length}</span> of {totalFiles} files
        </div>
      </div>
      <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-surface-container-high">
        <div
          className={cn("h-full rounded-full", meta.barClassName)}
          style={{ width: `${categoryShare}%` }}
        />
      </div>
      <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
        {files.length > 0 ? (
          files.map((file) => (
            <FileOwnershipRow file={file} key={file.filePath} metricMode={metricMode} />
          ))
        ) : (
          <div className="rounded-xl bg-surface-container-lowest p-5 text-sm text-on-surface-variant">
            No files in this ownership category.
          </div>
        )}
      </div>
    </SurfacePanel>
  );
};

type OwnershipPosturePanelProps = {
  posture: OwnershipPostureReportItem | null;
  summary: ChangeOwnershipMetrics | null;
};

const OwnershipPosturePanel = ({ posture, summary }: OwnershipPosturePanelProps) => {
  if (posture === null) {
    return (
      <SurfacePanel className="rounded-2xl p-6">
        <TitleMd as="h3">Repository Ownership Posture</TitleMd>
        <p className="mt-3 text-sm text-on-surface-variant">
          Ownership posture is unavailable for this snapshot.
        </p>
      </SurfacePanel>
    );
  }

  const meta = postureMeta(posture);

  return (
    <SurfacePanel className="rounded-2xl p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <TitleMd as="h3" className="flex items-center gap-2">
            <MaterialSymbol className="text-primary" icon="shield_person" />
            Repository Ownership Posture
          </TitleMd>
          <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">{posture.summary}</p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wider whitespace-nowrap",
            meta.chipClassName,
          )}
        >
          <MaterialSymbol icon={meta.icon} />
          {posture.title}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <div className="rounded-xl bg-surface-container-lowest p-4 shadow-sm">
          <MetaLabel as="p">Active Contributors</MetaLabel>
          <p className="mt-2 text-lg font-semibold text-on-surface">{posture.activeContributors}</p>
        </div>
        <div className="rounded-xl bg-surface-container-lowest p-4 shadow-sm">
          <div className="flex items-start gap-1.5">
            <MetaLabel as="p">Largest Contributor Share</MetaLabel>
            <LargestContributorShareInfo />
          </div>
          <p className={cn("mt-2 text-lg font-semibold", meta.accentClassName)}>
            {formatPercent(posture.largestContributorSharePercent)}
          </p>
        </div>
        <div className="rounded-xl bg-surface-container-lowest p-4 shadow-sm">
          <MetaLabel as="p">Shared Files</MetaLabel>
          <p className="mt-2 text-lg font-semibold text-tertiary">
            {formatPercent(summary?.sharedOwnershipPercent)}
          </p>
        </div>
        <div className="rounded-xl bg-surface-container-lowest p-4 shadow-sm">
          <MetaLabel as="p">Single Maintainer</MetaLabel>
          <p className="mt-2 text-lg font-semibold text-error">
            {formatPercent(summary?.singleMaintainerPercent)}
          </p>
        </div>
        <div className="rounded-xl bg-surface-container-lowest p-4 shadow-sm">
          <MetaLabel as="p">Single-Owner Modules</MetaLabel>
          <p className="mt-2 text-lg font-semibold text-on-surface">
            {formatPercent(posture.singleOwnerModulesPercent)}
          </p>
        </div>
        <div className="rounded-xl bg-surface-container-lowest p-4 shadow-sm">
          <MetaLabel as="p">Stale Owned Files</MetaLabel>
          <p className="mt-2 text-lg font-semibold text-secondary">
            {formatPercent(summary?.staleOwnedFilesPercent)}
          </p>
        </div>
      </div>
    </SurfacePanel>
  );
};

type FragileOwnershipAreasProps = {
  areas: readonly OwnershipRiskAreaReportItem[];
};

const FragileOwnershipAreas = ({ areas }: FragileOwnershipAreasProps) => (
  <SurfacePanel className="rounded-2xl p-6">
    <div className="mb-5 flex items-center justify-between gap-4">
      <TitleMd as="h3" className="flex items-center gap-2">
        <MaterialSymbol className="text-primary" icon="folder_managed" />
        Most Fragile Ownership Areas
      </TitleMd>
      <span className="rounded-full bg-surface-container-lowest px-3 py-1 text-[0.6875rem] font-bold uppercase tracking-wider text-on-surface-variant">
        Top 5 Modules
      </span>
    </div>

    <div className="space-y-3">
      {areas.length > 0 ? (
        areas.map((area) => {
          const tone = ownershipAreaTone(area);
          return (
            <div className="rounded-xl bg-surface-container-lowest p-4 shadow-sm" key={area.module}>
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="font-mono text-[0.75rem] text-on-surface">{area.module}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-1 text-[0.625rem] font-bold uppercase tracking-wider",
                        tone.chipClassName,
                      )}
                    >
                      {area.ownershipLabel}
                    </span>
                    <span className="rounded-full bg-surface-container-low px-2 py-1 text-[0.625rem] font-bold uppercase tracking-wider text-on-surface-variant">
                      {area.activeAuthors} authors
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-right">
                  <div>
                    <MetaLabel as="p">Top Share</MetaLabel>
                    <p className={cn("mt-1 font-semibold", tone.textClassName)}>
                      {formatSharePercent(area.topAuthorShareByCommits)}
                    </p>
                  </div>
                  <div>
                    <MetaLabel as="p">Recent Commits</MetaLabel>
                    <p className="mt-1 font-semibold text-on-surface">{area.recentCommits}</p>
                  </div>
                  <div>
                    <MetaLabel as="p">Total Commits</MetaLabel>
                    <p className="mt-1 font-semibold text-on-surface">{area.totalCommits}</p>
                  </div>
                </div>
              </div>
            </div>
          );
        })
      ) : (
        <div className="rounded-xl bg-surface-container-lowest p-5 text-sm text-on-surface-variant">
          Fragile ownership areas are unavailable for this snapshot.
        </div>
      )}
    </div>
  </SurfacePanel>
);

type ContributorOwnershipTableProps = {
  contributors: readonly OwnershipContributorReportItem[];
};

const ContributorOwnershipTable = ({ contributors }: ContributorOwnershipTableProps) => (
  <SurfacePanel className="rounded-2xl p-6">
    <div className="mb-5 flex items-center justify-between gap-4">
      <TitleMd as="h3" className="flex items-center gap-2">
        <MaterialSymbol className="text-primary" icon="groups_3" />
        Primary Knowledge Holders
      </TitleMd>
    </div>
    <p className="mb-4 text-sm text-on-surface-variant">
      Contributors who currently hold the most single-maintainer and concentrated file ownership.
    </p>

    <ReportTableFrame>
      <ReportTable className="min-w-[44rem] border-collapse">
        <thead>
          <ReportTableRow className="bg-surface-container-low" hover={false}>
            <ReportTableHeaderCell className="px-3 py-3" sticky>
              Contributor
            </ReportTableHeaderCell>
            <ReportTableHeaderCell align="right" className="px-3 py-3">
              Single
            </ReportTableHeaderCell>
            <ReportTableHeaderCell align="right" className="px-3 py-3">
              Concentrated
            </ReportTableHeaderCell>
            <ReportTableHeaderCell align="right" className="px-3 py-3">
              Owned Files
            </ReportTableHeaderCell>
            <ReportTableHeaderCell align="right" className="px-3 py-3">
              Commit Share
            </ReportTableHeaderCell>
            <ReportTableHeaderCell align="right" className="px-3 py-3">
              Owned Churn
            </ReportTableHeaderCell>
          </ReportTableRow>
        </thead>
        <tbody>
          {contributors.length > 0 ? (
            contributors.map((contributor) => (
              <ReportTableRow
                className="border-b border-outline-variant/10 text-sm transition-colors hover:bg-surface-container-low last:border-b-0"
                key={contributor.authorId}
              >
                <ReportTableCell className="px-3 py-3" sticky>
                  <div className="font-mono text-[0.75rem] text-on-surface">
                    {contributor.authorId}
                  </div>
                </ReportTableCell>
                <ReportTableCell align="right" className="px-3 py-3 font-semibold text-error">
                  {contributor.singleMaintainerFiles}
                </ReportTableCell>
                <ReportTableCell align="right" className="px-3 py-3 font-semibold text-on-surface">
                  {contributor.concentratedFiles}
                </ReportTableCell>
                <ReportTableCell align="right" className="px-3 py-3 font-semibold text-on-surface">
                  {contributor.ownedFiles}
                </ReportTableCell>
                <ReportTableCell align="right" className="px-3 py-3 font-semibold text-on-surface">
                  {formatPercent(contributor.totalCommitShare)}
                </ReportTableCell>
                <ReportTableCell align="right" className="px-3 py-3 font-semibold text-on-surface">
                  {formatPercent(contributor.ownedChurnShare)}
                </ReportTableCell>
              </ReportTableRow>
            ))
          ) : (
            <ReportTableRow hover={false}>
              <ReportTableCell className="px-3 py-5 text-sm text-on-surface-variant" colSpan={6}>
                Contributor concentration details are unavailable for this snapshot.
              </ReportTableCell>
            </ReportTableRow>
          )}
        </tbody>
      </ReportTable>
    </ReportTableFrame>
  </SurfacePanel>
);

export const ChangeOwnershipScreen = ({ report }: ChangeOwnershipScreenProps) => {
  const [ownershipMetricMode, setOwnershipMetricMode] = useState<OwnershipMetricMode>("commits");
  const summary = report.changeOwnership.available ? report.changeOwnership.metrics : null;
  const posture = report.changeOwnership.available ? report.changeOwnership.posture : null;
  const recentActivity = report.changeOwnership.available
    ? report.changeOwnership.recentActivity
    : [];
  const coChangePairs = report.changeOwnership.available
    ? report.changeOwnership.coChangePairs
    : [];
  const moduleKnowledge = report.changeOwnership.available
    ? report.changeOwnership.moduleKnowledge
    : [];
  const fragileAreas = report.changeOwnership.available ? report.changeOwnership.fragileAreas : [];
  const contributorOwnership = report.changeOwnership.available
    ? report.changeOwnership.contributorOwnership
    : [];
  const fileOwnership = report.changeOwnership.available
    ? (report.changeOwnership.fileOwnership ?? [])
    : [];
  const singleMaintainerFiles = fileOwnership.filter(
    (file) => file.ownershipLabel === "singleMaintainer",
  );
  const concentratedFiles = fileOwnership.filter((file) => file.ownershipLabel === "concentrated");
  const sharedFiles = fileOwnership.filter((file) => file.ownershipLabel === "shared");
  const bars = recentActivityBars(recentActivity);
  const startLabel = recentActivity[0]
    ? formatShortDate(recentActivity[0].bucketStartUtcDate)
    : "Start";
  const midpoint = recentActivity[Math.floor(recentActivity.length / 2)];
  const midLabel = midpoint ? formatShortDate(midpoint.bucketStartUtcDate) : "Mid";
  const endPoint = recentActivity[recentActivity.length - 1];
  const endLabel = endPoint ? formatShortDate(endPoint.bucketStartUtcDate) : "Today";

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

      <section className="grid grid-cols-12 items-start gap-6">
        <SurfacePanel className="relative col-span-12 overflow-hidden rounded-2xl p-8 lg:col-span-8">
          <div className="relative z-10">
            <TitleMd as="h3" className="mb-6 flex items-center gap-2">
              <MaterialSymbol className="text-primary" icon="trending_up" />
              Recent Activity Volatility ({summary?.recentWindowDays ?? 30} Days)
            </TitleMd>
            <div className="relative mt-4 flex h-48 items-end justify-between gap-1">
              {bars.length > 0 ? (
                bars.map((bar) => <RecentActivityBar bar={bar} key={bar.key} />)
              ) : (
                <div className="flex h-full w-full items-center justify-center rounded-xl bg-surface-container-lowest text-sm text-on-surface-variant">
                  Recent activity series unavailable.
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-between text-[0.6875rem] font-bold uppercase tracking-widest text-on-surface-variant">
              <span>{startLabel}</span>
              <span>{midLabel}</span>
              <span>{endLabel}</span>
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
          </div>
          <div className="mt-8 border-t border-outline-variant/10 pt-6">
            <div className="mb-6">
              <div className="mb-2 flex justify-between">
                <span className="text-[0.875rem] font-medium">Stale Owned Files</span>
                <span className="text-[0.875rem] font-semibold">
                  {formatPercent(summary?.staleOwnedFilesPercent)}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
                <div
                  className="h-full rounded-full bg-secondary/60"
                  style={{ width: `${summary?.staleOwnedFilesPercent ?? 0}%` }}
                />
              </div>
            </div>
            <div className="mb-4 h-px w-full bg-outline-variant/10" />
            <p className="text-[0.6875rem] leading-relaxed text-on-surface-variant">
              <span className="font-bold">INSIGHT:</span> {ownershipInsight(report)}
            </p>
          </div>
        </SurfaceCard>
      </section>

      <section className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1.15fr)]">
        <OwnershipPosturePanel posture={posture} summary={summary} />
        <ContributorOwnershipTable contributors={contributorOwnership} />
      </section>

      <FragileOwnershipAreas areas={fragileAreas} />

      <section className="space-y-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <TitleMd as="h2" className="flex items-center gap-2">
              File Ownership Distribution
              <OwnershipDistributionInfo />
            </TitleMd>
          </div>
          <OwnershipMetricSwitch value={ownershipMetricMode} onChange={setOwnershipMetricMode} />
        </div>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <FileOwnershipGroup
            files={singleMaintainerFiles}
            label="singleMaintainer"
            metricMode={ownershipMetricMode}
            totalFiles={fileOwnership.length}
          />
          <FileOwnershipGroup
            files={concentratedFiles}
            label="concentrated"
            metricMode={ownershipMetricMode}
            totalFiles={fileOwnership.length}
          />
          <FileOwnershipGroup
            files={sharedFiles}
            label="shared"
            metricMode={ownershipMetricMode}
            totalFiles={fileOwnership.length}
          />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <section>
          <div className="mb-6 flex items-center justify-between">
            <TitleMd as="h3">High Churn Hotspots</TitleMd>
            <span className="rounded bg-surface-container px-2 py-1 text-[0.6875rem] font-bold uppercase text-on-surface-variant">
              Top 5 Files
            </span>
          </div>
          <ReportTableFrame>
            <ReportTable className="min-w-[36rem] border-collapse">
              <thead>
                <ReportTableRow className="bg-surface-container-low" hover={false}>
                  <ReportTableHeaderCell sticky>File Path</ReportTableHeaderCell>
                  <ReportTableHeaderCell>Revisions (30d)</ReportTableHeaderCell>
                  <ReportTableHeaderCell>Risk Signal</ReportTableHeaderCell>
                </ReportTableRow>
              </thead>
              <tbody>
                {churnRows(report).map((hotspot) => {
                  const signal = hotspotSignal(hotspot);
                  return (
                    <ReportTableRow
                      className="transition-colors hover:bg-surface-container-low"
                      key={hotspot.target}
                    >
                      <ReportTableCell className="font-mono text-[0.75rem]" sticky>
                        {hotspot.target}
                      </ReportTableCell>
                      <ReportTableCell>{hotspot.recentCommitCount ?? 0}</ReportTableCell>
                      <ReportTableCell>
                        <span
                          className={cn("flex items-center gap-1 font-semibold", signal.className)}
                        >
                          <span className={cn("h-1.5 w-1.5 rounded-full", signal.dotClassName)} />
                          {signal.label}
                        </span>
                      </ReportTableCell>
                    </ReportTableRow>
                  );
                })}
              </tbody>
            </ReportTable>
          </ReportTableFrame>
        </section>

        <section>
          <div className="mb-6 flex items-center justify-between">
            <TitleMd as="h3">Co-change Relationships</TitleMd>
            <CoChangeInfo />
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
            {moduleKnowledge.slice(0, 8).map((module) => (
              <KnowledgeHeatmapTile key={module.module} module={module} />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
};
