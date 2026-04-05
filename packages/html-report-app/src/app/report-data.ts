import type { CodeSentinelReport, RiskTier } from "@codesentinel/reporter";

declare global {
  interface Window {
    __CODESENTINEL_REPORT__?: CodeSentinelReport;
  }
}

export type ScreenId =
  | "executive-overview"
  | "risk-drivers"
  | "hotspots"
  | "architecture"
  | "change-ownership"
  | "dependency-pressure"
  | "health-posture"
  | "compare";

export type ScreenDefinition = {
  id: ScreenId;
  label: string;
  icon: string;
};

export const screens: readonly ScreenDefinition[] = [
  { id: "executive-overview", label: "Executive Overview", icon: "dashboard" },
  { id: "risk-drivers", label: "Risk Drivers", icon: "security" },
  { id: "hotspots", label: "Hotspots", icon: "local_fire_department" },
  { id: "architecture", label: "Architecture", icon: "account_tree" },
  { id: "change-ownership", label: "Change & Ownership", icon: "history" },
  { id: "dependency-pressure", label: "Dependency Pressure", icon: "layers" },
  { id: "health-posture", label: "Health Posture", icon: "health_and_safety" },
  { id: "compare", label: "Compare", icon: "compare_arrows" },
];

export const getReport = (): CodeSentinelReport | undefined => window.__CODESENTINEL_REPORT__;

export const formatTimestamp = (value: string): string =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export const formatScore = (value: number | null | undefined): string =>
  value === null || value === undefined ? "n/a" : value.toFixed(value % 1 === 0 ? 0 : 1);

export const getRiskChipLabel = (tier: RiskTier): string => {
  switch (tier) {
    case "very_high":
      return "Very High";
    case "high":
      return "High";
    case "elevated":
      return "Medium-High";
    case "moderate":
      return "Moderate";
    case "low":
      return "Low";
  }
};

export const getRiskTone = (
  tier: RiskTier,
): {
  chipClassName: string;
  iconClassName: string;
  meterClassName: string;
  emphasisClassName: string;
} => {
  switch (tier) {
    case "low":
      return {
        chipClassName:
          "inline-flex items-center rounded-full bg-surface-container px-2.5 py-0.5 text-xs font-bold text-on-surface-variant",
        iconClassName: "text-on-surface-variant",
        meterClassName: "bg-primary/35",
        emphasisClassName: "text-on-surface",
      };
    case "moderate":
      return {
        chipClassName:
          "inline-flex items-center rounded-full bg-surface-container-high px-2.5 py-0.5 text-xs font-bold text-on-surface",
        iconClassName: "text-primary",
        meterClassName: "bg-primary/70",
        emphasisClassName: "text-on-surface",
      };
    case "elevated":
    case "high":
    case "very_high":
      return {
        chipClassName:
          "inline-flex items-center rounded-full bg-error-container/20 px-2.5 py-0.5 text-xs font-bold text-on-error-container",
        iconClassName: "text-error",
        meterClassName: "bg-error",
        emphasisClassName: "text-on-error-container",
      };
  }
};

export const getHealthChipLabel = (score: number): string => {
  if (score >= 80) {
    return "Strong Posture";
  }
  if (score >= 60) {
    return "Healthy Posture";
  }
  if (score >= 40) {
    return "Watch Posture";
  }
  return "Weak Posture";
};

export const getHealthTone = (
  score: number,
): {
  chipClassName: string;
  iconClassName: string;
  meterClassName: string;
  accentBorderClassName: string;
} => {
  if (score >= 80) {
    return {
      chipClassName:
        "inline-flex items-center rounded-full bg-tertiary-container/20 px-2.5 py-0.5 text-xs font-bold text-tertiary",
      iconClassName: "text-tertiary",
      meterClassName: "bg-tertiary",
      accentBorderClassName: "border-tertiary",
    };
  }

  if (score >= 60) {
    return {
      chipClassName:
        "inline-flex items-center rounded-full bg-tertiary-container/10 px-2.5 py-0.5 text-xs font-bold text-tertiary",
      iconClassName: "text-tertiary/85",
      meterClassName: "bg-tertiary/75",
      accentBorderClassName: "border-tertiary/60",
    };
  }

  if (score >= 40) {
    return {
      chipClassName:
        "inline-flex items-center rounded-full bg-surface-container px-2.5 py-0.5 text-xs font-bold text-on-surface-variant",
      iconClassName: "text-on-surface-variant",
      meterClassName: "bg-primary/40",
      accentBorderClassName: "border-outline-variant/40",
    };
  }

  return {
    chipClassName:
      "inline-flex items-center rounded-full bg-error-container/12 px-2.5 py-0.5 text-xs font-bold text-on-error-container",
    iconClassName: "text-error/80",
    meterClassName: "bg-error/70",
    accentBorderClassName: "border-error/45",
  };
};

export const getDimensionLevel = (value: number | null | undefined): string => {
  if (value === null || value === undefined) {
    return "Unknown";
  }
  if (value >= 70) {
    return "Critical";
  }
  if (value >= 45) {
    return "Moderate";
  }
  return "Low";
};

export const downloadReportJson = (report: CodeSentinelReport): void => {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${report.repository.name || "codesentinel-report"}.report.json`;
  anchor.click();
  URL.revokeObjectURL(url);
};
