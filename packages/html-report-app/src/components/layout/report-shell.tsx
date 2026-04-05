import type { ReactNode } from "react";
import type { CodeSentinelReport } from "@codesentinel/reporter";
import type { ScreenId } from "../../app/report-data";
import { ReportSidebar } from "./report-sidebar";
import { ReportTopbar } from "./report-topbar";

type ReportShellProps = {
  activeScreen: ScreenId;
  report: CodeSentinelReport;
  children: ReactNode;
};

export const ReportShell = ({ activeScreen, report, children }: ReportShellProps) => (
  <div className="min-h-screen bg-surface text-on-surface">
    <ReportSidebar activeScreen={activeScreen} />
    <div className="min-h-screen ml-64">
      <ReportTopbar report={report} />
      <div>{children}</div>
    </div>
  </div>
);
