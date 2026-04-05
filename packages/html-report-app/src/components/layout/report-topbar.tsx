import type { CodeSentinelReport } from "@codesentinel/reporter";
import { downloadReportJson, formatTimestamp } from "../../app/report-data";
import { IconButton, PrimaryButton } from "../design/actions";
import { cn } from "../../lib/utils";
import { MaterialSymbol } from "../material-symbol";

type ReportTopbarProps = {
  report: CodeSentinelReport;
  onMenuToggle: () => void;
};

export const ReportTopbar = ({ report, onMenuToggle }: ReportTopbarProps) => (
  <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between bg-white/80 px-8 backdrop-blur-xl shadow-sm">
    <div className="flex items-center gap-3 md:gap-6">
      <button
        className="rounded-lg p-2 text-[#5f5e60] transition-colors hover:bg-surface-container md:hidden"
        onClick={onMenuToggle}
        type="button"
      >
        <MaterialSymbol icon="menu" />
      </button>
      <h2 className="truncate text-xl font-semibold text-[#2d3338] max-md:text-lg">
        Repository Health
      </h2>
      <div className="hidden h-4 w-[1px] bg-outline-variant/30 sm:block" />
      <div
        className={cn(
          "flex items-center gap-2 text-[0.875rem] text-on-surface-variant",
          "max-sm:hidden",
        )}
      >
        <MaterialSymbol className="text-[18px]" icon="schedule" />
        <span className="truncate">Last Analysis: {formatTimestamp(report.generatedAt)}</span>
      </div>
    </div>

    <div className="flex items-center gap-2 md:gap-4">
      <div className="hidden items-center gap-2 md:flex">
        <IconButton type="button">
          <MaterialSymbol icon="filter_list" />
        </IconButton>
        <IconButton type="button">
          <MaterialSymbol icon="settings" />
        </IconButton>
      </div>
      <PrimaryButton
        className="whitespace-nowrap px-3 text-xs md:px-4 md:text-sm"
        onClick={() => downloadReportJson(report)}
        type="button"
      >
        <span className="sm:hidden">
          <MaterialSymbol icon="download" />
        </span>
        <span className="hidden sm:inline">Download Report</span>
      </PrimaryButton>
    </div>
  </header>
);
