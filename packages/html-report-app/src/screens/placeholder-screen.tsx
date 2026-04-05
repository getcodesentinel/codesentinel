import type { ScreenId } from "../app/report-data";

type PlaceholderScreenProps = {
  screen: ScreenId;
};

const titleByScreen: Record<ScreenId, string> = {
  "executive-overview": "Executive Overview",
  "risk-drivers": "Risk Drivers",
  hotspots: "Hotspots & Triage",
  architecture: "Architecture & Structure",
  "change-ownership": "Change & Ownership",
  "dependency-pressure": "Dependency Pressure",
  "health-posture": "Health Posture",
  compare: "Compare & CI Status",
};

export const PlaceholderScreen = ({ screen }: PlaceholderScreenProps) => (
  <main className="max-w-7xl p-8">
    <div className="rounded-xl bg-surface-container-lowest p-8 shadow-[0_12px_40px_rgba(45,51,56,0.04)]">
      <p className="mb-2 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-tertiary">
        Screen in progress
      </p>
      <h1 className="mb-3 text-4xl font-semibold tracking-tight text-on-surface">
        {titleByScreen[screen]}
      </h1>
      <p className="max-w-2xl text-[0.875rem] leading-relaxed text-on-surface-variant">
        This screen has been intentionally left as a placeholder while the frontend is rebuilt
        screen-by-screen from the Stitch source. The shell and Executive Overview are now the
        canonical starting point for the redesign.
      </p>
    </div>
  </main>
);
