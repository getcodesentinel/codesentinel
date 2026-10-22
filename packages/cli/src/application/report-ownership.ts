import { execFileSync } from "node:child_process";
import type { OwnershipAudit } from "@codesentinel/ownership";
import type { OwnershipAuditReport } from "@codesentinel/reporter";
import { buildOwnershipAudit } from "./build-ownership-audit.js";
import type { Logger } from "./logger.js";

const stripGitSuffix = (path: string): string => path.replace(/\.git\/?$/i, "").replace(/\/+$/, "");

export const normalizeRepositoryWebUrl = (raw: string): string | null => {
  const value = raw.trim();
  if (value.length === 0) {
    return null;
  }

  if (!value.includes("://")) {
    const scpMatch = value.match(/^(?:[^@\s]+@)?([^:/\s]+):(.+)$/);
    if (scpMatch === null) {
      return null;
    }

    const host = scpMatch[1];
    const path = stripGitSuffix(scpMatch[2] ?? "").replace(/^\/+/, "");
    if (host === undefined || path.length === 0) {
      return null;
    }
    return `https://${host}/${path}`;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:" && url.protocol !== "ssh:") {
    return null;
  }

  const path = stripGitSuffix(url.pathname).replace(/^\/+/, "");
  if (url.hostname.length === 0 || path.length === 0) {
    return null;
  }
  return `https://${url.hostname}/${path}`;
};

export const readRepositoryWebUrl = (repositoryPath: string): string | null => {
  try {
    const raw = execFileSync(
      "git",
      ["-C", repositoryPath, "config", "--get", "remote.origin.url"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return normalizeRepositoryWebUrl(raw);
  } catch {
    return null;
  }
};

export const toOwnershipAuditReport = (audit: OwnershipAudit): OwnershipAuditReport => {
  if (!audit.available) {
    return {
      available: false,
      reason: audit.reason,
      warnings: audit.warnings,
    };
  }

  return {
    available: true,
    codeowners: {
      source: audit.codeowners.source,
      ignoredSources: audit.codeowners.ignoredSources,
      errors: audit.codeowners.errors,
    },
    metrics: audit.metrics,
    ghostOwners: audit.ghostOwners,
    files: audit.files,
    ignoredAuthors: audit.ignoredAuthors,
    warnings: audit.warnings,
  };
};

export const buildReportOwnership = async (
  repositoryPath: string,
  logger: Logger,
): Promise<{ ownership: OwnershipAuditReport; webUrl: string | null }> => {
  const webUrl = readRepositoryWebUrl(repositoryPath);

  try {
    const { audit } = await buildOwnershipAudit(repositoryPath, {}, logger);
    return { ownership: toOwnershipAuditReport(audit), webUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ownership audit error.";
    logger.warn(`ownership audit unavailable: ${message}`);
    return {
      ownership: {
        available: false,
        reason: "audit_unavailable",
        warnings: [message],
      },
      webUrl,
    };
  }
};
