import { createHash } from "node:crypto";
import type { FileOwnershipAudit, OwnershipStatus } from "@codesentinel/ownership";
import { formatDeclaredOwners, type OwnersReport } from "./format-owners-output.js";

export const SARIF_SCHEMA_URI = "https://json.schemastore.org/sarif-2.1.0.json";
export const SARIF_VERSION = "2.1.0";
export const CODESENTINEL_INFORMATION_URI = "https://github.com/getcodesentinel/codesentinel";

export type SarifLevel = "error" | "warning" | "note" | "none";

export type SarifPhysicalLocation = {
  artifactLocation: { uri: string };
  region: { startLine: number };
};

export type SarifLocation = {
  physicalLocation: SarifPhysicalLocation;
};

export type SarifRelatedLocation = {
  id: number;
  message: { text: string };
  physicalLocation: SarifPhysicalLocation;
};

export type SarifRule = {
  id: string;
  name: string;
  shortDescription: { text: string };
  helpUri: string;
  defaultConfiguration: { level: SarifLevel };
};

export type SarifFingerprints = {
  "codesentinel/v1": string;
};

export type SarifResult = {
  ruleId: string;
  ruleIndex: number;
  level: SarifLevel;
  message: { text: string };
  locations: SarifLocation[];
  relatedLocations?: SarifRelatedLocation[];
  partialFingerprints: SarifFingerprints;
};

export type SarifRun = {
  tool: {
    driver: {
      name: string;
      informationUri: string;
      version: string;
      rules: SarifRule[];
    };
  };
  results: SarifResult[];
};

export type SarifLog = {
  $schema: string;
  version: string;
  runs: SarifRun[];
};

export type OwnersSarifContext = { toolVersion: string };

type OwnershipRule = {
  id: string;
  name: string;
  level: SarifLevel;
  shortDescription: string;
};

const RULES: readonly OwnershipRule[] = [
  {
    id: "ownership/unowned-critical",
    name: "UnownedCritical",
    level: "error",
    shortDescription: "Critical file without a declared owner",
  },
  {
    id: "ownership/ghost-owner",
    name: "GhostOwner",
    level: "error",
    shortDescription: "Declared owner with no commits in the window",
  },
  {
    id: "ownership/drift",
    name: "Drift",
    level: "warning",
    shortDescription: "Declared owner is not the recent top author",
  },
  {
    id: "ownership/unknown",
    name: "Unknown",
    level: "warning",
    shortDescription: "Ownership could not be verified offline",
  },
];

const RULE_ID_BY_STATUS: Partial<Record<OwnershipStatus, string>> = {
  "unowned-critical": "ownership/unowned-critical",
  ghosted: "ownership/ghost-owner",
  drifted: "ownership/drift",
  unknown: "ownership/unknown",
};

const RULE_INDEX_BY_ID = new Map(RULES.map((rule, index) => [rule.id, index]));

const buildRules = (): SarifRule[] =>
  RULES.map((rule) => ({
    id: rule.id,
    name: rule.name,
    shortDescription: { text: rule.shortDescription },
    helpUri: `${CODESENTINEL_INFORMATION_URI}#ownership-audit`,
    defaultConfiguration: { level: rule.level },
  }));

/**
 * SARIF artifact URIs are relative POSIX paths. Absolute paths, drive letters, `.` and `..`
 * segments would either leak the machine layout or let the URI escape the repository root.
 */
export const normalizeSarifUri = (filePath: string): string => {
  const withoutDrive = filePath.replace(/\\/g, "/").replace(/^[A-Za-z]:\//, "");
  const segments: string[] = [];

  for (const segment of withoutDrive.split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return segments.join("/");
};

const fingerprintFor = (ruleId: string, uri: string): string =>
  createHash("sha256").update(`${ruleId}\u0000${uri}`).digest("hex");

const formatShare = (share: number | null): string =>
  share === null ? "n/a" : `${Math.round(share * 100)}%`;

const formatEvidence = (file: FileOwnershipAudit): string => {
  const criticality = file.criticality.isHotspot ? "hotspot, " : "";
  return `fan-in ${file.criticality.fanIn ?? "n/a"}, ${criticality}${file.observed.commits} commits, ${file.observed.authors} authors`;
};

const buildMessage = (file: FileOwnershipAudit, windowDays: number): string => {
  const owners = formatDeclaredOwners(file.declared);

  switch (file.status) {
    case "unowned-critical":
      return `\`${file.filePath}\` has no declared owner and is critical (${formatEvidence(file)}).`;
    case "ghosted":
      return `\`${file.filePath}\` is declared to ${owners}, but none of its owners committed in the last ${windowDays} days (${file.observed.commits} commits, top author ${file.observed.topAuthorId ?? "unknown"}).`;
    case "drifted":
      return `\`${file.filePath}\` is declared to ${owners}, but the top recent author is ${file.observed.topAuthorId ?? "unknown"} (${formatShare(file.observed.topAuthorShare)} of commits).`;
    case "unknown":
      return `\`${file.filePath}\` is declared to ${owners}, but its ownership cannot be verified offline.`;
    default:
      return `\`${file.filePath}\` has no ownership finding.`;
  }
};

const buildResult = (file: FileOwnershipAudit, report: OwnersReport): SarifResult | null => {
  const ruleId = RULE_ID_BY_STATUS[file.status];
  const ruleIndex = ruleId === undefined ? undefined : RULE_INDEX_BY_ID.get(ruleId);
  if (ruleId === undefined || ruleIndex === undefined) {
    return null;
  }

  const uri = normalizeSarifUri(file.filePath);
  const relatedLocations: SarifRelatedLocation[] = [];

  if (file.matchLine !== null && report.codeowners !== null) {
    relatedLocations.push({
      id: 1,
      message: {
        text: `Ownership declared in ${report.codeowners.source} line ${file.matchLine}.`,
      },
      physicalLocation: {
        artifactLocation: { uri: normalizeSarifUri(report.codeowners.source) },
        region: { startLine: file.matchLine },
      },
    });
  }

  return {
    ruleId,
    ruleIndex,
    level: RULES[ruleIndex]?.level ?? "warning",
    message: { text: buildMessage(file, report.windowDays) },
    locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: 1 } } }],
    ...(relatedLocations.length > 0 ? { relatedLocations } : {}),
    partialFingerprints: { "codesentinel/v1": fingerprintFor(ruleId, uri) },
  };
};

export const buildOwnersSarif = (report: OwnersReport, context: OwnersSarifContext): SarifLog => {
  const results: SarifResult[] = [];

  if (report.available) {
    for (const file of report.files) {
      const result = buildResult(file, report);
      if (result !== null) {
        results.push(result);
      }
    }
  }

  return {
    $schema: SARIF_SCHEMA_URI,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: "CodeSentinel",
            informationUri: CODESENTINEL_INFORMATION_URI,
            version: context.toolVersion,
            rules: buildRules(),
          },
        },
        results,
      },
    ],
  };
};

export const formatOwnersSarif = (report: OwnersReport, context: OwnersSarifContext): string =>
  JSON.stringify(buildOwnersSarif(report, context), null, 2);
