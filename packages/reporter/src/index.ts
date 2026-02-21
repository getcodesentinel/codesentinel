export type ReportFormat = "json" | "text";

export type RiskReport = {
  generatedAt: Date;
  summary: string;
};

export const formatReport = (report: RiskReport, format: ReportFormat): string => {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }

  return `${report.summary}`;
};
