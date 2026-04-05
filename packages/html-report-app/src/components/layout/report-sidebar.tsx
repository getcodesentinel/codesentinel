import { screens } from "../../app/report-data";
import type { ScreenId } from "../../app/report-data";
import { SurfacePanel } from "../design/surfaces";
import { LabelSm, NavText } from "../design/typography";
import { MaterialSymbol } from "../material-symbol";
import { cn } from "../../lib/utils";

type ReportSidebarProps = {
  activeScreen: ScreenId;
  isMobileMenuOpen: boolean;
  onNavigate: () => void;
};

export const ReportSidebar = ({
  activeScreen,
  isMobileMenuOpen,
  onNavigate,
}: ReportSidebarProps) => (
  <aside
    className={cn(
      "fixed left-0 top-0 z-50 flex h-screen flex-col bg-[#f2f4f6] py-6 transition-transform duration-300 md:translate-x-0 md:w-[4.5rem] lg:w-64",
      isMobileMenuOpen ? "translate-x-0 w-64" : "-translate-x-full w-64",
    )}
  >
    <div className="mb-10 flex items-center gap-3 overflow-hidden px-4 lg:px-6">
      <div className="flex h-10 w-10 min-w-[2.5rem] items-center justify-center rounded-lg bg-primary text-on-primary">
        <MaterialSymbol className="text-[24px]" icon="security" />
      </div>
      <div className="block md:hidden lg:block">
        <h1 className="whitespace-nowrap text-lg font-semibold tracking-tight text-[#2d3338]">
          CodeSentinel
        </h1>
        <LabelSm as="p" className="tracking-widest">
          Engineering Intelligence
        </LabelSm>
      </div>
    </div>

    <nav className="flex-1 space-y-1 px-2 lg:px-3">
      {screens.map((screen) => (
        <a
          className={
            screen.id === activeScreen
              ? "flex items-center gap-3 border-r-2 border-[#5f5e60] bg-white/50 px-3 py-2.5 font-semibold text-[#2d3338] transition-all duration-200 ease-in-out md:justify-center lg:justify-start"
              : "flex items-center gap-3 px-3 py-2.5 font-medium text-[#596065] transition-colors hover:bg-white/30 md:justify-center lg:justify-start"
          }
          href={`#${screen.id}`}
          key={screen.id}
          onClick={onNavigate}
        >
          <MaterialSymbol className="shrink-0" icon={screen.icon} />
          <NavText as="span" className="text-inherit md:hidden lg:inline">
            {screen.label}
          </NavText>
        </a>
      ))}
    </nav>

    <div className="mt-auto px-2 lg:px-6">
      <SurfacePanel className="flex flex-col items-start bg-surface-container-high/50 p-2 md:items-center lg:items-start lg:p-4">
        <LabelSm as="p" className="mb-2 tracking-widest md:hidden lg:block">
          Workspace
        </LabelSm>
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-tertiary" />
          <span className="whitespace-nowrap text-xs font-semibold text-on-surface md:hidden lg:inline">
            Core Infrastructure
          </span>
        </div>
      </SurfacePanel>
    </div>
  </aside>
);
