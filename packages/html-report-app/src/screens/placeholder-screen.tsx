import type { ScreenId } from "../app/report-data";
import { PageIntro } from "../components/design/page-intro";
import { SurfaceCard } from "../components/design/surfaces";

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
  <main className="mx-auto flex w-full max-w-7xl flex-col gap-12 p-4 md:p-8">
    <PageIntro
      description="This screen is not implemented yet and will be completed in the same report redesign pass."
      label="Screen In Progress"
      labelClassName="text-tertiary"
      title={titleByScreen[screen]}
    />

    <SurfaceCard className="max-w-3xl p-8">
      <p className="max-w-2xl text-[0.875rem] leading-relaxed text-on-surface-variant">
        The screen content has been intentionally left as a placeholder while the report is being
        rebuilt screen by screen from the approved design compositions. Shared layout and design
        primitives are already in place so the final implementation can drop into the same system
        without changing the surrounding shell.
      </p>
    </SurfaceCard>
  </main>
);
