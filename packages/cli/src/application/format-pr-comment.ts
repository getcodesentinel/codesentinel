export const PR_COMMENT_MARKER = "<!-- codesentinel:summary -->";

export class PrCommentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrCommentConfigurationError";
  }
}

export type PrCommentInput = {
  risk: { current: number; delta: number | null };
  health: { current: number; delta: number | null };
  ownership: {
    available: boolean;
    unownedCritical: number | null;
    unownedCriticalDelta: number | null;
    ghostOwners: number | null;
    ghostOwnersDelta: number | null;
    driftPercent: number | null;
    driftPercentDelta: number | null;
  };
  offenders: readonly {
    filePath: string;
    status: string;
    owners: string;
    evidence: string;
  }[];
};

type JsonRecord = Record<string, unknown>;

type OwnershipMetrics = {
  unownedCritical: number | null;
  ghostOwners: number | null;
  driftPercent: number | null;
};

const OFFENDER_STATUSES: ReadonlySet<string> = new Set([
  "unowned-critical",
  "ghosted",
  "drifted",
  "unknown",
]);

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

const invalidInput = (field: string, expectation: string): never => {
  throw new PrCommentConfigurationError(`invalid CI JSON input: ${field} must be ${expectation}`);
};

const readMetrics = (source: JsonRecord): OwnershipMetrics | null => {
  const metrics = source["metrics"];
  if (!isRecord(metrics)) {
    return null;
  }

  return {
    unownedCritical: readFiniteNumber(metrics["unownedCriticalCount"]),
    ghostOwners: readFiniteNumber(metrics["ghostOwnerCount"]),
    driftPercent: readFiniteNumber(metrics["driftPercent"]),
  };
};

const deltaWhenKnown = (
  current: number | null,
  baseline: number | null,
  enabled: boolean,
): number | null =>
  enabled && current !== null && baseline !== null ? round4(current - baseline) : null;

const formatOffenderOwner = (owner: unknown): string | null => {
  if (!isRecord(owner)) {
    return null;
  }

  const kind = owner["kind"];
  if (kind === "user") {
    const handle = readString(owner["handle"]);
    return handle === null ? null : `@${handle}`;
  }
  if (kind === "team") {
    const org = readString(owner["org"]);
    const slug = readString(owner["slug"]);
    return org === null || slug === null ? null : `@${org}/${slug}`;
  }
  if (kind === "email") {
    return readString(owner["address"]);
  }

  return null;
};

const formatOffenderOwners = (declared: unknown): string => {
  if (!Array.isArray(declared)) {
    return "—";
  }

  const owners = declared
    .map(formatOffenderOwner)
    .filter((owner): owner is string => owner !== null);
  return owners.length === 0 ? "—" : owners.join(", ");
};

const readEvidence = (
  status: string,
  observed: JsonRecord | null,
  criticality: JsonRecord | null,
): string => {
  const topAuthorId = observed === null ? null : readString(observed["topAuthorId"]);

  switch (status) {
    case "unowned-critical": {
      const fanIn = criticality === null ? null : readFiniteNumber(criticality["fanIn"]);
      const commits = observed === null ? null : readFiniteNumber(observed["commits"]);
      const authors = observed === null ? null : readFiniteNumber(observed["authors"]);
      return `fan-in ${fanIn ?? "n/a"}, ${commits ?? 0} commits, ${authors ?? 0} authors`;
    }
    case "ghosted":
      return `no commits in the window, top author ${topAuthorId ?? "unknown"}`;
    case "drifted": {
      const share = observed === null ? null : readFiniteNumber(observed["topAuthorShare"]);
      const renderedShare = share === null ? "n/a" : `${Math.round(share * 100)}%`;
      return `top author ${topAuthorId ?? "unknown"} (${renderedShare})`;
    }
    default:
      return "ownership cannot be verified offline";
  }
};

const parseOwnership = (
  summaryOwnership: unknown,
  current: JsonRecord,
): {
  available: boolean;
  metrics: OwnershipMetrics | null;
  offenders: PrCommentInput["offenders"];
} => {
  const snapshotOwnership = current["ownership"];
  const source = isRecord(snapshotOwnership)
    ? snapshotOwnership
    : isRecord(summaryOwnership)
      ? summaryOwnership
      : null;

  if (source === null || source["available"] !== true) {
    return { available: false, metrics: null, offenders: [] };
  }

  const metrics = readMetrics(source);
  if (metrics === null) {
    return { available: false, metrics: null, offenders: [] };
  }

  const files = Array.isArray(source["files"]) ? source["files"] : [];
  const offenders: {
    filePath: string;
    status: string;
    owners: string;
    evidence: string;
  }[] = [];

  for (const entry of files) {
    if (offenders.length >= 5) {
      break;
    }
    if (!isRecord(entry)) {
      continue;
    }

    const status = readString(entry["status"]);
    const filePath = readString(entry["filePath"]);
    if (status === null || filePath === null || !OFFENDER_STATUSES.has(status)) {
      continue;
    }

    const observed = isRecord(entry["observed"]) ? entry["observed"] : null;
    const criticality = isRecord(entry["criticality"]) ? entry["criticality"] : null;
    offenders.push({
      filePath,
      status,
      owners: formatOffenderOwners(entry["declared"]),
      evidence: readEvidence(status, observed, criticality),
    });
  }

  return { available: true, metrics, offenders };
};

const formatSigned = (value: number | null): string => {
  if (value === null) {
    return "n/a";
  }
  if (value === 0) {
    return "0";
  }
  return value > 0 ? `+${String(value)}` : String(value);
};

const formatCount = (value: number | null): string => (value === null ? "n/a" : String(value));

const formatPercent = (value: number | null): string =>
  value === null ? "n/a" : `${String(value)}%`;

const formatPercentagePoints = (value: number | null): string =>
  value === null ? "n/a" : `${formatSigned(value)} pp`;

const escapeTableCell = (value: string): string => value.replace(/\|/g, "\\|");

const renderTableRow = (cells: readonly string[]): string =>
  `| ${cells.map(escapeTableCell).join(" | ")} |`;

export const parsePrCommentInput = (raw: unknown): PrCommentInput => {
  if (!isRecord(raw)) {
    return invalidInput("root", "an object");
  }

  const current = raw["current"];
  if (!isRecord(current)) {
    return invalidInput("current", "an object");
  }

  const analysis = current["analysis"];
  if (!isRecord(analysis)) {
    return invalidInput("current.analysis", "an object");
  }

  const risk = analysis["risk"];
  if (!isRecord(risk)) {
    return invalidInput("current.analysis.risk", "an object");
  }
  const riskScore = readFiniteNumber(risk["riskScore"]);
  if (riskScore === null) {
    return invalidInput("current.analysis.risk.riskScore", "a finite number");
  }

  const health = analysis["health"];
  if (!isRecord(health)) {
    return invalidInput("current.analysis.health", "an object");
  }
  const healthScore = readFiniteNumber(health["healthScore"]);
  if (healthScore === null) {
    return invalidInput("current.analysis.health.healthScore", "a finite number");
  }

  const baselineRaw = raw["baseline"];
  const baseline = isRecord(baselineRaw) ? baselineRaw : null;

  const diffRaw = raw["diff"];
  const diff = isRecord(diffRaw) ? diffRaw : null;
  const riskDelta = diff === null ? null : readFiniteNumber(diff["riskScoreDelta"]);

  const baselineHealthScore = (() => {
    if (baseline === null) {
      return null;
    }
    const baselineAnalysis = baseline["analysis"];
    if (!isRecord(baselineAnalysis)) {
      return null;
    }
    const baselineHealth = baselineAnalysis["health"];
    if (!isRecord(baselineHealth)) {
      return null;
    }
    return readFiniteNumber(baselineHealth["healthScore"]);
  })();
  const healthDelta =
    baselineHealthScore === null ? null : round4(healthScore - baselineHealthScore);

  const ownershipRaw = raw["ownership"];
  const ownership = parseOwnership(ownershipRaw, current);

  const baselineOwnership = baseline === null ? undefined : baseline["ownership"];
  const baselineMetrics = isRecord(baselineOwnership) ? readMetrics(baselineOwnership) : null;

  const metrics = ownership.metrics;
  const baselineEnabled = ownership.available && baselineMetrics !== null;

  return {
    risk: { current: riskScore, delta: riskDelta },
    health: { current: healthScore, delta: healthDelta },
    ownership: {
      available: ownership.available,
      unownedCritical: metrics?.unownedCritical ?? null,
      unownedCriticalDelta: deltaWhenKnown(
        metrics?.unownedCritical ?? null,
        baselineMetrics?.unownedCritical ?? null,
        baselineEnabled,
      ),
      ghostOwners: metrics?.ghostOwners ?? null,
      ghostOwnersDelta: deltaWhenKnown(
        metrics?.ghostOwners ?? null,
        baselineMetrics?.ghostOwners ?? null,
        baselineEnabled,
      ),
      driftPercent: metrics?.driftPercent ?? null,
      driftPercentDelta: deltaWhenKnown(
        metrics?.driftPercent ?? null,
        baselineMetrics?.driftPercent ?? null,
        baselineEnabled,
      ),
    },
    offenders: ownership.offenders,
  };
};

export const renderPrCommentBody = (input: PrCommentInput): string => {
  const lines: string[] = [
    PR_COMMENT_MARKER,
    "",
    "### CodeSentinel summary",
    "",
    "| Signal | Current | Delta |",
    "| --- | --- | --- |",
    renderTableRow(["Risk", String(input.risk.current), formatSigned(input.risk.delta)]),
    renderTableRow(["Health", String(input.health.current), formatSigned(input.health.delta)]),
    renderTableRow([
      "Unowned critical",
      formatCount(input.ownership.unownedCritical),
      formatSigned(input.ownership.unownedCriticalDelta),
    ]),
    renderTableRow([
      "Ghost owners",
      formatCount(input.ownership.ghostOwners),
      formatSigned(input.ownership.ghostOwnersDelta),
    ]),
    renderTableRow([
      "Drift",
      formatPercent(input.ownership.driftPercent),
      formatPercentagePoints(input.ownership.driftPercentDelta),
    ]),
  ];

  if (!input.ownership.available) {
    lines.push("");
    lines.push("_Ownership audit unavailable: no CODEOWNERS file was found._");
  }

  lines.push("");
  lines.push("**Top offenders**");
  lines.push("");

  if (input.offenders.length === 0) {
    lines.push("No ownership findings.");
  } else {
    lines.push("| File | Status | Owner | Evidence |");
    lines.push("| --- | --- | --- | --- |");
    for (const offender of input.offenders) {
      lines.push(
        renderTableRow([
          `\`${offender.filePath}\``,
          offender.status,
          offender.owners,
          offender.evidence,
        ]),
      );
    }
  }

  return lines.join("\n");
};

export const hasPrCommentChanges = (previousBody: string | null, nextBody: string): boolean =>
  previousBody === null || previousBody.trim() !== nextBody.trim();
