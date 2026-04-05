import { useEffect, useState, type ReactNode } from "react";
import type { CodeSentinelReport } from "@codesentinel/reporter";
import type { ScreenId } from "../../app/report-data";
import { cn } from "../../lib/utils";
import { ReportSidebar } from "./report-sidebar";
import { ReportTopbar } from "./report-topbar";

type ReportShellProps = {
  activeScreen: ScreenId;
  report: CodeSentinelReport;
  children: ReactNode;
};

export const ReportShell = ({ activeScreen, report, children }: ReportShellProps) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const syncMenuState = () => {
      if (window.innerWidth >= 768) {
        setIsMobileMenuOpen(false);
      }
    };

    syncMenuState();
    window.addEventListener("resize", syncMenuState);
    return () => window.removeEventListener("resize", syncMenuState);
  }, []);

  useEffect(() => {
    document.body.style.overflow = isMobileMenuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileMenuOpen]);

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <ReportSidebar
        activeScreen={activeScreen}
        isMobileMenuOpen={isMobileMenuOpen}
        onNavigate={() => setIsMobileMenuOpen(false)}
      />
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity md:hidden",
          isMobileMenuOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setIsMobileMenuOpen(false)}
      />
      <div className="min-h-screen transition-all duration-300 md:ml-[4.5rem] lg:ml-64">
        <ReportTopbar onMenuToggle={() => setIsMobileMenuOpen((value) => !value)} report={report} />
        <div>{children}</div>
      </div>
    </div>
  );
};
