import type { CodeSentinelReport } from "@codesentinel/reporter";
import { downloadReportJson, formatTimestamp } from "../../app/report-data";
import { IconButton, PrimaryButton } from "../design/actions";
import { BodyMd } from "../design/typography";
import { MaterialSymbol } from "../material-symbol";

type ReportTopbarProps = {
  report: CodeSentinelReport;
};

export const ReportTopbar = ({ report }: ReportTopbarProps) => (
  <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between bg-white/80 px-8 backdrop-blur-xl shadow-sm">
    <div className="flex items-center gap-6">
      <h2 className="text-xl font-semibold text-[#2d3338]">Repository Health</h2>
      <div className="h-4 w-[1px] bg-outline-variant/30" />
      <BodyMd as="div" className="flex items-center gap-2">
        <MaterialSymbol className="text-[18px]" icon="schedule" />
        <span>Last Analysis: {formatTimestamp(report.generatedAt)}</span>
      </BodyMd>
    </div>

    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <IconButton type="button">
          <MaterialSymbol icon="filter_list" />
        </IconButton>
        <IconButton type="button">
          <MaterialSymbol icon="settings" />
        </IconButton>
      </div>
      <PrimaryButton onClick={() => downloadReportJson(report)} type="button">
        Download Report
      </PrimaryButton>
    </div>
  </header>
);
