import { useState } from "react";
import type {
  CodeSentinelReport,
  DeclaredOwnerReportItem,
  OwnershipAuditStatus,
  OwnershipFileReportItem,
} from "@codesentinel/reporter";
import { BodyMd, BodySm, MetaLabel, MetricValue, TitleMd } from "../components/design/typography";
import {
  ReportTable,
  ReportTableCell,
  ReportTableFrame,
  ReportTableHeaderCell,
  ReportTableRow,
} from "../components/design/report-table";
import { SurfacePanel } from "../components/design/surfaces";
import { MaterialSymbol } from "../components/material-symbol";
import { cn } from "../lib/utils";

type ChangeOwnershipAuditBlockProps = {
  report: CodeSentinelReport;
};

type OwnershipFilter = "all" | "aligned" | "drifted" | "ghosted" | "unowned" | "unowned-critical";

const MAX_RENDERED_FILES = 50;
const MAX_AUDIT_NOTES = 4;
const CODEOWNERS_DOCS_URL =
  "https://docs.github.com/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners";

const STATUS_FILTERS: readonly { value: OwnershipFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "aligned", label: "Aligned" },
  { value: "drifted", label: "Drifted" },
  { value: "ghosted", label: "Ghosted" },
  { value: "unowned", label: "Unowned" },
  { value: "unowned-critical", label: "Unowned critical" },
];

const STATUS_META: Readonly<Record<OwnershipAuditStatus, { label: string; className: string }>> = {
  aligned: {
    label: "Aligned",
    className: "bg-tertiary/10 text-tertiary",
  },
  drifted: {
    label: "Drifted",
    className: "bg-surface-container-high text-on-surface-variant",
  },
  ghosted: {
    label: "Ghost owner",
    className: "bg-error/10 text-error",
  },
  unowned: {
    label: "Unowned",
    className: "bg-surface-container-high text-on-surface-variant",
  },
  "unowned-critical": {
    label: "Unowned critical",
    className: "bg-error/10 text-error",
  },
  "insufficient-evidence": {
    label: "Insufficient evidence",
    className: "bg-surface-container-high text-on-surface-variant",
  },
  unknown: {
    label: "Unknown",
    className: "bg-surface-container-high text-on-surface-variant",
  },
};

const formatPercent = (value: number): string =>
  Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

const initialsFromText = (value: string): string => {
  const parts = value
    .replace(/^@/, "")
    .split(/[.\-_\s]+/)
    .map((part) => part.replace(/^@/, ""))
    .filter((part) => part.length > 0);
  const letters = parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase());
  return letters.join("") || "?";
};

const declaredOwnerLabel = (owner: DeclaredOwnerReportItem): string => {
  if (owner.kind === "user") {
    return `@${owner.handle}`;
  }
  if (owner.kind === "team") {
    return `@${owner.org}/${owner.slug}`;
  }
  return owner.address;
};

const declaredOwnerInitials = (owner: DeclaredOwnerReportItem): string => {
  if (owner.kind === "team") {
    return initialsFromText(`${owner.org} ${owner.slug}`);
  }
  return initialsFromText(declaredOwnerLabel(owner));
};

const FilePathLink = ({ filePath, webUrl }: { filePath: string; webUrl: string | null }) => {
  const className =
    "break-words font-mono text-[0.75rem] font-semibold leading-snug text-on-surface [overflow-wrap:anywhere]";

  if (webUrl === null) {
    return <span className={className}>{filePath}</span>;
  }

  return (
    <a
      className={cn(className, "hover:text-tertiary hover:underline")}
      href={`${webUrl}/blob/HEAD/${filePath}`}
      rel="noreferrer"
      target="_blank"
    >
      {filePath}
    </a>
  );
};

const CodeownersReference = ({
  source,
  matchLine,
  webUrl,
}: {
  source: string;
  matchLine: number | null;
  webUrl: string | null;
}) => {
  const className = "mt-1 break-words text-[0.6875rem] leading-snug text-on-surface-variant";

  if (matchLine === null) {
    return <div className={className}>No CODEOWNERS match</div>;
  }

  const label = `${source} line ${matchLine}`;
  if (webUrl === null) {
    return <div className={className}>{label}</div>;
  }

  return (
    <a
      className={cn(className, "inline-block hover:text-tertiary hover:underline")}
      href={`${webUrl}/blob/HEAD/${source}#L${matchLine}`}
      rel="noreferrer"
      target="_blank"
    >
      {label}
    </a>
  );
};

const OwnerChip = ({ owner }: { owner: DeclaredOwnerReportItem }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-lowest px-2 py-1 text-[0.6875rem] text-on-surface">
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-tertiary/10 text-[0.5625rem] font-bold text-tertiary">
      {declaredOwnerInitials(owner)}
    </span>
    <span className="break-words font-mono [overflow-wrap:anywhere]">
      {declaredOwnerLabel(owner)}
    </span>
    {owner.kind === "team" ? (
      <span className="rounded bg-surface-container-high px-1 text-[0.5625rem] font-bold uppercase tracking-wider text-on-surface-variant">
        team
      </span>
    ) : null}
  </span>
);

const DeclaredOwners = ({ file }: { file: OwnershipFileReportItem }) => {
  if (file.declared.length === 0) {
    return (
      <span className="text-[0.75rem] text-on-surface-variant">
        {file.matchLine === null ? "No entry" : "Deliberately unowned"}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {file.declared.map((owner, index) => (
        <OwnerChip key={`${declaredOwnerLabel(owner)}-${index}`} owner={owner} />
      ))}
    </div>
  );
};

const ObservedAuthor = ({ file }: { file: OwnershipFileReportItem }) => {
  if (file.observed.topAuthorId === null) {
    return <span className="text-[0.75rem] text-on-surface-variant">No author evidence</span>;
  }

  return (
    <div className="flex items-start gap-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary/10 text-[0.5625rem] font-bold text-secondary">
        {initialsFromText(file.observed.topAuthorId)}
      </span>
      <div className="min-w-0">
        <div className="break-words font-mono text-[0.75rem] text-on-surface [overflow-wrap:anywhere]">
          {file.observed.topAuthorId}
        </div>
        {file.observed.topAuthorShare === null ? null : (
          <div className="text-[0.6875rem] text-on-surface-variant">
            {Math.round(file.observed.topAuthorShare * 100)}% of commits
          </div>
        )}
      </div>
    </div>
  );
};

const StatusChip = ({ status }: { status: OwnershipAuditStatus }) => {
  const meta = STATUS_META[status];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wider whitespace-nowrap",
        meta.className,
      )}
    >
      {meta.label}
    </span>
  );
};

const CoverageTrack = ({
  label,
  percent,
  counts,
  barClassName,
}: {
  label: string;
  percent: number;
  counts: string;
  barClassName: string;
}) => (
  <div>
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[0.8125rem] font-medium text-on-surface">{label}</span>
      <span className="text-[0.875rem] font-semibold text-on-surface">
        {formatPercent(percent)}
      </span>
    </div>
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-container-high">
      <div
        className={cn("h-full rounded-full", barClassName)}
        style={{ width: `${clampPercent(percent)}%` }}
      />
    </div>
    <div className="mt-1.5 text-[0.6875rem] text-on-surface-variant">{counts}</div>
  </div>
);

const AuditStat = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-xl bg-surface-container-lowest px-4 py-3 shadow-xs">
    <MetaLabel as="p">{label}</MetaLabel>
    <p className="mt-1 text-lg font-semibold text-on-surface">{value}</p>
  </div>
);

const UnownedCriticalPanel = ({
  files,
  webUrl,
}: {
  files: readonly OwnershipFileReportItem[];
  webUrl: string | null;
}) => {
  const unownedCritical = files
    .filter((file) => file.status === "unowned-critical")
    .sort((a, b) => {
      const aFanIn = a.criticality.fanIn;
      const bFanIn = b.criticality.fanIn;
      if (aFanIn !== bFanIn) {
        if (aFanIn === null) {
          return 1;
        }
        if (bFanIn === null) {
          return -1;
        }
        return bFanIn - aFanIn;
      }
      return b.observed.commits - a.observed.commits || a.filePath.localeCompare(b.filePath);
    });

  return (
    <SurfacePanel className="rounded-2xl p-6">
      <div className="mb-1 flex items-center gap-2">
        <MaterialSymbol className="text-error" icon="warning" />
        <TitleMd as="h3">Unowned critical files</TitleMd>
      </div>
      <p className="mb-5 text-[0.8125rem] text-on-surface-variant">
        Ordered by fan-in, then commit volume.
      </p>

      {unownedCritical.length === 0 ? (
        <div className="rounded-xl bg-surface-container-lowest p-5 text-sm text-on-surface-variant">
          No unowned critical files in this repository.
        </div>
      ) : (
        <div className="space-y-3">
          {unownedCritical.map((file) => (
            <div
              className="rounded-xl bg-surface-container-lowest p-4 shadow-xs"
              key={file.filePath}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <FilePathLink filePath={file.filePath} webUrl={webUrl} />
                  <p className="mt-2 text-[0.75rem] leading-relaxed text-on-surface-variant">
                    Declared ownership is missing on a file the structural analysis marks as
                    critical.
                  </p>
                </div>
                <div className="grid shrink-0 grid-cols-2 gap-4 text-right">
                  <div>
                    <MetaLabel as="p">Fan-in</MetaLabel>
                    <p className="mt-1 font-semibold text-on-surface">
                      {file.criticality.fanIn ?? "n/a"}
                    </p>
                  </div>
                  <div>
                    <MetaLabel as="p">Commits</MetaLabel>
                    <p className="mt-1 font-semibold text-on-surface">{file.observed.commits}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </SurfacePanel>
  );
};

const AuditNotes = ({ warnings }: { warnings: readonly string[] }) => {
  if (warnings.length === 0) {
    return null;
  }

  const visibleWarnings = warnings.slice(0, MAX_AUDIT_NOTES);
  const remaining = warnings.length - visibleWarnings.length;

  return (
    <div className="rounded-xl bg-surface-container-low px-4 py-3">
      <MetaLabel as="p">Audit notes</MetaLabel>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[0.75rem] leading-relaxed text-on-surface-variant">
        {visibleWarnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
        {remaining > 0 ? <li>+{remaining} more</li> : null}
      </ul>
    </div>
  );
};

const UnavailableAudit = ({ report }: { report: CodeSentinelReport }) => {
  const ownership = report.ownership;
  const reason = ownership?.available === false ? ownership.reason : null;
  const warnings = ownership?.available === false ? ownership.warnings : [];
  const isAuditUnavailable = reason === "audit_unavailable";

  return (
    <SurfacePanel className="rounded-2xl p-6 md:p-8">
      <div className="flex flex-col gap-5 md:flex-row md:items-start">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface-container-lowest text-primary shadow-xs">
          <MaterialSymbol icon="policy" />
        </div>
        <div className="min-w-0 space-y-3">
          <div>
            <MetaLabel as="p">CODEOWNERS audit</MetaLabel>
            <TitleMd as="h2">Declared ownership is not configured</TitleMd>
          </div>

          <BodyMd>
            A CODEOWNERS file declares who GitHub asks to review each path. Comparing that
            declaration with the authors who actually change the files reveals where ownership is
            drifted, ghosted, or missing on critical code.
          </BodyMd>

          <BodyMd>
            {reason === "codeowners_not_found"
              ? "No CODEOWNERS file was found, so declared versus observed ownership cannot be audited."
              : isAuditUnavailable
                ? "The ownership audit could not run in this environment, so declared versus observed ownership is unavailable."
                : "This report does not include an ownership audit. It may have been generated without a git repository or by an older version."}
          </BodyMd>

          <BodyMd>
            To start, create <code className="font-mono text-on-surface">.github/CODEOWNERS</code>,
            add <code className="font-mono text-on-surface">* @your-handle</code>, then add a more
            specific path line such as{" "}
            <code className="font-mono text-on-surface">src/core/ @your-team</code>. Observed
            ownership is derived from <code className="font-mono text-on-surface">git log</code>{" "}
            evidence and stays offline.
          </BodyMd>

          <a
            className="inline-block text-[0.8125rem] font-medium text-tertiary hover:underline"
            href={CODEOWNERS_DOCS_URL}
            rel="noreferrer"
            target="_blank"
          >
            GitHub CODEOWNERS documentation
          </a>

          {warnings.length > 0 ? <AuditNotes warnings={warnings} /> : null}
        </div>
      </div>
    </SurfacePanel>
  );
};

export const ChangeOwnershipAuditBlock = ({ report }: ChangeOwnershipAuditBlockProps) => {
  const [filter, setFilter] = useState<OwnershipFilter>("all");
  const ownership = report.ownership;

  if (ownership === undefined || !ownership.available) {
    return <UnavailableAudit report={report} />;
  }

  const { codeowners, metrics, files, warnings } = ownership;
  const webUrl = report.repository.webUrl ?? null;
  const totalFiles = files.length;
  const declaredFiles = files.filter((file) => file.declared.length > 0).length;
  const criticalFiles = files.filter((file) => file.criticality.isCritical).length;
  const declaredCriticalFiles = files.filter(
    (file) => file.criticality.isCritical && file.declared.length > 0,
  ).length;
  const insufficientEvidenceCount = files.filter(
    (file) => file.status === "insufficient-evidence",
  ).length;
  const unknownCount = files.filter((file) => file.status === "unknown").length;

  const filterCount = (value: OwnershipFilter): number =>
    value === "all" ? totalFiles : files.filter((file) => file.status === value).length;

  const filteredFiles = filter === "all" ? files : files.filter((file) => file.status === filter);
  const visibleFiles = filteredFiles.slice(0, MAX_RENDERED_FILES);
  const hiddenFiles = filteredFiles.length - visibleFiles.length;
  const hasExtraStatuses = insufficientEvidenceCount > 0 || unknownCount > 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="max-w-3xl">
          <MetaLabel as="p">CODEOWNERS audit</MetaLabel>
          <TitleMd as="h2">Declared vs observed ownership</TitleMd>
          <BodyMd className="mt-2">
            Declared ownership comes from CODEOWNERS. Observed ownership comes from git history.
            This is a systems-risk view, not a ranking of people.
          </BodyMd>
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-full bg-surface-container-high px-3 py-1.5">
          <MaterialSymbol className="text-[1rem] text-on-surface-variant" icon="policy" />
          {webUrl === null ? (
            <span className="font-mono text-[0.6875rem] text-on-surface-variant">
              {codeowners.source}
            </span>
          ) : (
            <a
              className="font-mono text-[0.6875rem] text-on-surface-variant hover:text-tertiary hover:underline"
              href={`${webUrl}/blob/HEAD/${codeowners.source}`}
              rel="noreferrer"
              target="_blank"
            >
              {codeowners.source}
            </a>
          )}
        </div>
      </div>

      <SurfacePanel className="rounded-2xl p-6 md:p-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div>
            <MetaLabel as="p">Critical files declared</MetaLabel>
            <div className="mt-2 flex items-baseline gap-2">
              <MetricValue className="text-4xl">
                {formatPercent(metrics.declaredCoverageCriticalPercent)}
              </MetricValue>
            </div>
            <BodySm className="mt-3">
              This is the metric that matters: an undeclared critical file carries the highest
              handoff risk, no matter how healthy the repository-wide coverage looks.
            </BodySm>
          </div>

          <div className="space-y-5">
            <CoverageTrack
              barClassName="bg-tertiary"
              counts={`${declaredFiles} of ${totalFiles} files have a declaration`}
              label="Declared files"
              percent={metrics.declaredCoveragePercent}
            />
            <CoverageTrack
              barClassName="bg-secondary"
              counts={`${declaredCriticalFiles} of ${criticalFiles} critical files have a declaration`}
              label="Critical files declared"
              percent={metrics.declaredCoverageCriticalPercent}
            />
          </div>
        </div>

        <div className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <AuditStat label="Drift" value={formatPercent(metrics.driftPercent)} />
          <AuditStat label="Ghost owners" value={metrics.ghostOwnerCount} />
          <AuditStat label="Unowned critical" value={metrics.unownedCriticalCount} />
          <AuditStat label="Single-owner modules" value={metrics.singleOwnerModuleCount} />
        </div>
      </SurfacePanel>

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((item) => {
          const isActive = filter === item.value;
          return (
            <button
              aria-pressed={isActive}
              className={cn(
                "rounded-full px-3 py-1.5 text-[0.6875rem] font-bold uppercase tracking-wider transition-colors",
                isActive
                  ? "bg-on-surface text-surface"
                  : "bg-surface-container-high text-on-surface-variant hover:text-on-surface",
              )}
              key={item.value}
              onClick={() => setFilter(item.value)}
              type="button"
            >
              {item.label} ({filterCount(item.value)})
            </button>
          );
        })}
      </div>

      {hasExtraStatuses ? (
        <p className="text-[0.6875rem] text-on-surface-variant">
          Also in this table: {insufficientEvidenceCount} insufficient evidence, {unknownCount}{" "}
          unknown.
        </p>
      ) : null}

      <ReportTableFrame
        className="border border-outline-variant/10"
        scrollClassName="max-h-[42rem] overflow-auto"
      >
        <ReportTable className="min-w-[64rem] border-collapse">
          <thead>
            <ReportTableRow className="bg-surface-container-low" hover={false}>
              <ReportTableHeaderCell className="top-0" sticky>
                File
              </ReportTableHeaderCell>
              <ReportTableHeaderCell className="sticky top-0 z-10 bg-surface-container-low">
                Declared owners
              </ReportTableHeaderCell>
              <ReportTableHeaderCell className="sticky top-0 z-10 bg-surface-container-low">
                Observed author
              </ReportTableHeaderCell>
              <ReportTableHeaderCell className="sticky top-0 z-10 bg-surface-container-low">
                Status
              </ReportTableHeaderCell>
            </ReportTableRow>
          </thead>
          <tbody className="divide-y divide-outline-variant/10">
            {visibleFiles.map((file) => (
              <ReportTableRow key={file.filePath}>
                <ReportTableCell className="py-5 align-top" sticky>
                  <FilePathLink filePath={file.filePath} webUrl={webUrl} />
                  <CodeownersReference
                    matchLine={file.matchLine}
                    source={codeowners.source}
                    webUrl={webUrl}
                  />
                </ReportTableCell>
                <ReportTableCell className="py-5 align-top">
                  <DeclaredOwners file={file} />
                </ReportTableCell>
                <ReportTableCell className="py-5 align-top">
                  <ObservedAuthor file={file} />
                </ReportTableCell>
                <ReportTableCell className="py-5 align-top">
                  <StatusChip status={file.status} />
                </ReportTableCell>
              </ReportTableRow>
            ))}
            {visibleFiles.length === 0 ? (
              <ReportTableRow hover={false}>
                <ReportTableCell className="py-5 text-sm text-on-surface-variant" colSpan={4}>
                  No files match this status.
                </ReportTableCell>
              </ReportTableRow>
            ) : null}
          </tbody>
        </ReportTable>
      </ReportTableFrame>

      {hiddenFiles > 0 ? (
        <p className="text-[0.75rem] text-on-surface-variant">
          Showing {visibleFiles.length} of {files.length} files. Use the status filters to narrow
          the list.
        </p>
      ) : null}

      <UnownedCriticalPanel files={files} webUrl={webUrl} />

      <AuditNotes warnings={warnings} />
    </section>
  );
};
