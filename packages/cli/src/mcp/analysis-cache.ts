import type { AnalyzeSummary } from "@codesentinel/core";
import type { OwnershipAudit } from "@codesentinel/ownership";
import { buildOwnershipAudit } from "../application/build-ownership-audit.js";
import type { Logger } from "../application/logger.js";
import { runAnalyzeCommand } from "../application/run-analyze-command.js";

export type McpAnalysis = AnalyzeSummary;

export type AnalysisCache = {
  getAnalysis: () => Promise<McpAnalysis>;
  getOwnershipAudit: (ref: string) => Promise<OwnershipAudit>;
};

export const createAnalysisCache = (root: string, logger: Logger): AnalysisCache => {
  let analysisPromise: Promise<McpAnalysis> | null = null;
  const ownershipPromises = new Map<string, Promise<OwnershipAudit>>();

  const getAnalysis = (): Promise<McpAnalysis> => {
    if (analysisPromise === null) {
      analysisPromise = runAnalyzeCommand(root, "likely_merge", {}, logger).catch((error) => {
        analysisPromise = null;
        throw error;
      });
    }
    return analysisPromise;
  };

  const getOwnershipAudit = (ref: string): Promise<OwnershipAudit> => {
    const cached = ownershipPromises.get(ref);
    if (cached !== undefined) {
      return cached;
    }

    const pending = buildOwnershipAudit(root, { ref }, logger)
      .then((result) => result.audit)
      .catch((error) => {
        ownershipPromises.delete(ref);
        throw error;
      });
    ownershipPromises.set(ref, pending);
    return pending;
  };

  return { getAnalysis, getOwnershipAudit };
};
