import { useEffect, useState } from "react";
import { ExecutiveOverviewScreen } from "../screens/executive-overview-screen";
import { PlaceholderScreen } from "../screens/placeholder-screen";
import { getReport, screens } from "./report-data";
import type { ScreenId } from "./report-data";
import { ReportShell } from "../components/layout/report-shell";

const DEFAULT_SCREEN: ScreenId = "executive-overview";

const getScreenFromHash = (): ScreenId => {
  const raw = window.location.hash.replace(/^#/, "");
  const screen = screens.find((entry) => entry.id === raw);
  return screen?.id ?? DEFAULT_SCREEN;
};

export const ReportApp = () => {
  const report = getReport();
  const [screen, setScreen] = useState<ScreenId>(() =>
    typeof window === "undefined" ? DEFAULT_SCREEN : getScreenFromHash(),
  );

  useEffect(() => {
    const onHashChange = () => {
      setScreen(getScreenFromHash());
    };

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (window.location.hash === "") {
      window.location.hash = DEFAULT_SCREEN;
    }
  }, []);

  if (report === undefined) {
    return (
      <main className="screen-placeholder">
        <div className="screen-placeholder__card">
          <p className="screen-placeholder__eyebrow">Report payload missing</p>
          <h1 className="screen-placeholder__title">The HTML report was loaded without data.</h1>
          <p className="screen-placeholder__copy">
            This bundle expects `window.__CODESENTINEL_REPORT__` to be injected before the app
            boots.
          </p>
        </div>
      </main>
    );
  }

  return (
    <ReportShell activeScreen={screen} report={report}>
      {screen === "executive-overview" ? (
        <ExecutiveOverviewScreen report={report} />
      ) : (
        <PlaceholderScreen screen={screen} />
      )}
    </ReportShell>
  );
};
