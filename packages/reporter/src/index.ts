import type { CodeSentinelReport, ReportFormat } from "./domain.js";
import { compareSnapshots } from "./diff.js";
import { createReport } from "./report.js";
import { renderMarkdownReport, renderTextReport } from "./renderers.js";
import { createSnapshot, parseSnapshot } from "./snapshot.js";

export {
  SNAPSHOT_SCHEMA_VERSION,
  REPORT_SCHEMA_VERSION,
  RISK_MODEL_VERSION,
  factorLabel,
  summarizeEvidence,
  type CodeSentinelSnapshot,
  type CodeSentinelReport,
  type HealthIssue,
  type HotspotReportItem,
  type SnapshotDiff,
  type RiskTier,
  type StructuralCycleDetail,
  type StructuralFileExtreme,
  type RiskyDependencyReportItem,
  type ReportFormat,
} from "./domain.js";

export { createSnapshot, parseSnapshot, compareSnapshots, createReport };

export const formatReport = (report: CodeSentinelReport, format: ReportFormat): string => {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }

  if (format === "md") {
    return renderMarkdownReport(report);
  }

  return renderTextReport(report);
};
