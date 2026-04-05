import { screens } from "../../app/report-data";
import type { ScreenId } from "../../app/report-data";
import { SurfacePanel } from "../design/surfaces";
import { LabelSm, NavText } from "../design/typography";
import { MaterialSymbol } from "../material-symbol";

type ReportSidebarProps = {
  activeScreen: ScreenId;
};

export const ReportSidebar = ({ activeScreen }: ReportSidebarProps) => (
  <aside className="fixed left-0 top-0 z-50 flex h-screen w-64 flex-col bg-[#f2f4f6] py-6">
    <div className="mb-10 px-6">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-on-primary">
          <MaterialSymbol className="text-[20px]" icon="security" />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-[#2d3338]">CodeSentinel</h1>
          <LabelSm as="p" className="tracking-widest">
            Engineering Intelligence
          </LabelSm>
        </div>
      </div>
    </div>

    <nav className="flex-1 space-y-1 px-3">
      {screens.map((screen) => (
        <a
          className={
            screen.id === activeScreen
              ? "flex items-center gap-3 border-r-2 border-[#5f5e60] bg-white/50 px-3 py-2.5 font-semibold text-[#2d3338] transition-all duration-200 ease-in-out"
              : "flex items-center gap-3 px-3 py-2.5 font-medium text-[#596065] transition-colors hover:bg-white/30"
          }
          href={`#${screen.id}`}
          key={screen.id}
        >
          <MaterialSymbol icon={screen.icon} />
          <NavText as="span" className="text-inherit">
            {screen.label}
          </NavText>
        </a>
      ))}
    </nav>

    <div className="mt-auto px-6">
      <SurfacePanel className="bg-surface-container-high/50 p-4">
        <LabelSm as="p" className="mb-2 tracking-widest">
          Workspace
        </LabelSm>
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-tertiary" />
          <span className="text-xs font-semibold text-on-surface">Core Infrastructure</span>
        </div>
      </SurfacePanel>
    </div>
  </aside>
);
