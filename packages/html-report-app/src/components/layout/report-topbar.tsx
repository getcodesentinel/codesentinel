import type { CodeSentinelReport } from "@codesentinel/reporter";
import { downloadReportJson, formatTimestamp } from "../../app/report-data";
import { MaterialSymbol } from "../material-symbol";

type ReportTopbarProps = {
  report: CodeSentinelReport;
};

export const ReportTopbar = ({ report }: ReportTopbarProps) => (
  <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between bg-white/80 px-8 backdrop-blur-xl shadow-sm">
    <div className="flex items-center gap-6">
      <h2 className="text-xl font-semibold text-[#2d3338]">Repository Health</h2>
      <div className="h-4 w-[1px] bg-outline-variant/30" />
      <div className="flex items-center gap-2 font-['Inter'] text-[0.875rem] text-on-surface-variant">
        <MaterialSymbol className="text-[18px]" icon="schedule" />
        <span>Last Analysis: {formatTimestamp(report.generatedAt)}</span>
      </div>
    </div>

    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <button
          className="rounded-lg p-2 text-[#5f5e60] transition-colors hover:text-[#2d3338]"
          type="button"
        >
          <MaterialSymbol icon="filter_list" />
        </button>
        <button
          className="rounded-lg p-2 text-[#5f5e60] transition-colors hover:text-[#2d3338]"
          type="button"
        >
          <MaterialSymbol icon="settings" />
        </button>
      </div>
      <button
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-all hover:opacity-90 active:scale-[0.99]"
        onClick={() => downloadReportJson(report)}
        type="button"
      >
        Download Report
      </button>
    </div>
  </header>
);
