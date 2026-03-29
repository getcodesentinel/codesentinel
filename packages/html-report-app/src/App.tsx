import { Fragment, useState, type ReactNode } from "react";
import type {
  CodeSentinelReport,
  HealthIssue,
  HotspotReportItem,
  RiskTier,
} from "@codesentinel/reporter";
import {
  AlertTriangle,
  ArrowDownUp,
  Flame,
  GitCompareArrows,
  HeartPulse,
  PackageSearch,
  ShieldAlert,
  Workflow,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./components/ui/accordion";
import { Badge } from "./components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { ScrollArea } from "./components/ui/scroll-area";
import { Separator } from "./components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";

declare global {
  interface Window {
    __CODESENTINEL_REPORT__?: CodeSentinelReport;
  }
}

type HotspotSortKey = "rank" | "target" | "score" | "churnTotal" | "commitCount";
type DependencySortKey = "name" | "score" | "dependencyScope";

const report = window.__CODESENTINEL_REPORT__;

const formatScore = (value: number | null | undefined): string =>
  value === null || value === undefined ? "n/a" : value.toFixed(value % 1 === 0 ? 0 : 1);

const formatTimestamp = (value: string): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const badgeVariantForRisk = (tier: RiskTier): "success" | "warning" | "danger" => {
  if (tier === "low" || tier === "moderate") {
    return "success";
  }
  if (tier === "elevated") {
    return "warning";
  }
  return "danger";
};

const healthVariant = (score: number): "success" | "warning" | "danger" => {
  if (score >= 75) {
    return "success";
  }
  if (score >= 45) {
    return "warning";
  }
  return "danger";
};

const issueVariant = (severity: HealthIssue["severity"]): "warning" | "danger" =>
  severity === "error" ? "danger" : "warning";

const DependencyScopeBadge = ({ scope }: { scope: "prod" | "dev" | "unknown" }) => (
  <Badge variant={scope === "prod" ? "danger" : scope === "dev" ? "warning" : "outline"}>
    {scope}
  </Badge>
);

const SortButton = ({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`inline-flex items-center gap-1 ${active ? "text-foreground" : "text-muted-foreground"}`}
  >
    {label}
    <ArrowDownUp className="h-3.5 w-3.5" />
  </button>
);

const EmptyState = ({ title, description }: { title: string; description: string }) => (
  <Card className="border-dashed bg-card/60">
    <CardContent className="flex min-h-40 flex-col items-center justify-center gap-2 text-center">
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
    </CardContent>
  </Card>
);

const MetricCard = ({
  title,
  value,
  badge,
  description,
  icon,
}: {
  title: string;
  value: string;
  badge: ReactNode;
  description: string;
  icon: ReactNode;
}) => (
  <Card>
    <CardHeader className="gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-2xl bg-secondary p-3 text-muted-foreground">{icon}</div>
        {badge}
      </div>
      <div>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="mt-2 text-3xl">{value}</CardTitle>
      </div>
    </CardHeader>
    <CardContent>
      <p className="text-sm text-muted-foreground">{description}</p>
    </CardContent>
  </Card>
);

const DimensionBar = ({ label, value }: { label: string; value: number | null }) => {
  const normalized = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium capitalize">{label}</span>
        <span className="font-mono text-muted-foreground">{formatScore(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-secondary">
        <div
          className="h-2 rounded-full bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-500"
          style={{ width: `${normalized}%` }}
        />
      </div>
    </div>
  );
};

const HotspotsTable = ({ items }: { items: readonly HotspotReportItem[] }) => {
  const [sortKey, setSortKey] = useState<HotspotSortKey>("score");
  const [descending, setDescending] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(items[0]?.target ?? null);

  const toggleSort = (key: HotspotSortKey) => {
    if (sortKey === key) {
      setDescending((value) => !value);
      return;
    }
    setSortKey(key);
    setDescending(key !== "target");
  };

  const sortedItems = [...items].sort((left, right) => {
    const direction = descending ? -1 : 1;
    if (sortKey === "target") {
      return left.target.localeCompare(right.target) * direction;
    }
    const leftValue = left[sortKey] ?? -1;
    const rightValue = right[sortKey] ?? -1;
    return (leftValue < rightValue ? 1 : leftValue > rightValue ? -1 : 0) * direction;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hotspot ranking</CardTitle>
        <CardDescription>
          Risk rank combines structural stress, change volatility, and interaction pressure.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="w-full">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <SortButton
                    label="Rank"
                    active={sortKey === "rank"}
                    onClick={() => toggleSort("rank")}
                  />
                </TableHead>
                <TableHead>
                  <SortButton
                    label="File"
                    active={sortKey === "target"}
                    onClick={() => toggleSort("target")}
                  />
                </TableHead>
                <TableHead>
                  <SortButton
                    label="Score"
                    active={sortKey === "score"}
                    onClick={() => toggleSort("score")}
                  />
                </TableHead>
                <TableHead>
                  <SortButton
                    label="Churn"
                    active={sortKey === "churnTotal"}
                    onClick={() => toggleSort("churnTotal")}
                  />
                </TableHead>
                <TableHead>
                  <SortButton
                    label="Commits"
                    active={sortKey === "commitCount"}
                    onClick={() => toggleSort("commitCount")}
                  />
                </TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedItems.map((item) => {
                const isExpanded = expanded === item.target;
                return (
                  <Fragment key={item.target}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpanded(isExpanded ? null : item.target)}
                    >
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        #{item.rank}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium">{item.target}</div>
                          <div className="font-mono text-xs text-muted-foreground">
                            {item.module}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{formatScore(item.score)}</span>
                          <Badge
                            variant={
                              item.score >= 70 ? "danger" : item.score >= 40 ? "warning" : "success"
                            }
                          >
                            {item.score >= 70
                              ? "critical"
                              : item.score >= 40
                                ? "elevated"
                                : "watch"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {item.churnTotal ?? "n/a"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {item.commitCount ?? "n/a"}
                      </TableCell>
                      <TableCell className="max-w-sm text-muted-foreground">
                        {item.reason}
                      </TableCell>
                    </TableRow>
                    {isExpanded ? (
                      <TableRow data-state="open">
                        <TableCell colSpan={6}>
                          <div className="grid gap-4 py-2 lg:grid-cols-[1.1fr_0.9fr]">
                            <div className="space-y-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                Risk contributions
                              </p>
                              <div className="grid gap-2 sm:grid-cols-3">
                                <Card className="bg-background/70 shadow-none">
                                  <CardContent className="py-4">
                                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                                      Structural
                                    </p>
                                    <p className="mt-2 text-lg font-semibold">
                                      {formatScore(item.riskContributions.structural * 100)}
                                    </p>
                                  </CardContent>
                                </Card>
                                <Card className="bg-background/70 shadow-none">
                                  <CardContent className="py-4">
                                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                                      Evolution
                                    </p>
                                    <p className="mt-2 text-lg font-semibold">
                                      {formatScore(item.riskContributions.evolution * 100)}
                                    </p>
                                  </CardContent>
                                </Card>
                                <Card className="bg-background/70 shadow-none">
                                  <CardContent className="py-4">
                                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                                      External
                                    </p>
                                    <p className="mt-2 text-lg font-semibold">
                                      {formatScore(item.riskContributions.external * 100)}
                                    </p>
                                  </CardContent>
                                </Card>
                              </div>
                            </div>
                            <div className="space-y-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                Actions and evidence
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {item.suggestedActions.length === 0 ? (
                                  <Badge
                                    className="px-4 py-3 normal-case tracking-normal"
                                    variant="outline"
                                  >
                                    No suggested actions
                                  </Badge>
                                ) : (
                                  item.suggestedActions.map((action) => (
                                    <Badge
                                      key={action}
                                      className="px-4 py-3 text-sm normal-case tracking-normal"
                                      variant="outline"
                                    >
                                      {action}
                                    </Badge>
                                  ))
                                )}
                              </div>
                              <div className="space-y-2 text-sm text-muted-foreground">
                                {item.topFactors.map((factor) => (
                                  <div
                                    key={factor.id}
                                    className="rounded-xl border border-border/60 bg-background/80 p-3"
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="font-medium text-foreground">
                                        {factor.label}
                                      </span>
                                      <span className="font-mono text-xs">
                                        {formatScore(factor.contribution)}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-xs">{factor.evidence}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

const DependenciesTable = ({
  items,
}: {
  items: Extract<CodeSentinelReport["external"], { available: true }>["riskyDependencies"];
}) => {
  const [sortKey, setSortKey] = useState<DependencySortKey>("score");
  const [descending, setDescending] = useState(true);

  const toggleSort = (key: DependencySortKey) => {
    if (sortKey === key) {
      setDescending((value) => !value);
      return;
    }
    setSortKey(key);
    setDescending(key !== "name");
  };

  const sortedItems = [...items].sort((left, right) => {
    const direction = descending ? -1 : 1;
    if (sortKey === "name" || sortKey === "dependencyScope") {
      return left[sortKey].localeCompare(right[sortKey]) * direction;
    }
    return (left.score < right.score ? 1 : left.score > right.score ? -1 : 0) * direction;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Risky dependencies</CardTitle>
        <CardDescription>
          Direct and inherited registry signals summarized from the analysis snapshot.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <SortButton
                  label="Dependency"
                  active={sortKey === "name"}
                  onClick={() => toggleSort("name")}
                />
              </TableHead>
              <TableHead>
                <SortButton
                  label="Score"
                  active={sortKey === "score"}
                  onClick={() => toggleSort("score")}
                />
              </TableHead>
              <TableHead>
                <SortButton
                  label="Scope"
                  active={sortKey === "dependencyScope"}
                  onClick={() => toggleSort("dependencyScope")}
                />
              </TableHead>
              <TableHead>Signals</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedItems.map((item) => (
              <TableRow key={item.name}>
                <TableCell>
                  <div className="space-y-1">
                    <div className="font-medium">{item.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {item.resolvedVersion ?? "version unknown"}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="font-semibold">{formatScore(item.score)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <DependencyScopeBadge scope={item.dependencyScope} />
                    {item.direct ? <Badge variant="outline">direct</Badge> : null}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    {item.riskSignals.length === 0 ? (
                      <Badge variant="outline">no explicit signals</Badge>
                    ) : (
                      item.riskSignals.map((signal) => (
                        <Badge key={signal} variant="outline">
                          {signal}
                        </Badge>
                      ))
                    )}
                  </div>
                </TableCell>
                <TableCell className="max-w-sm text-muted-foreground">{item.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export const App = () => {
  if (report === undefined) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-16">
        <EmptyState
          title="Report data missing"
          description="Expected window.__CODESENTINEL_REPORT__ to be defined before the app bootstraps."
        />
      </main>
    );
  }

  const externalAvailable = report.external.available;

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
      <section className="overflow-hidden rounded-[28px] border border-border/60 bg-white/70 p-6 shadow-panel backdrop-blur sm:p-8">
        <div className="grid gap-8 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={badgeVariantForRisk(report.repository.riskTier)}>
                {report.repository.riskTier.replaceAll("_", " ")}
              </Badge>
              <Badge variant={healthVariant(report.health.healthScore)}>
                {report.repository.healthTier}
              </Badge>
              <Badge variant="outline">{report.schemaVersion}</Badge>
            </div>
            <div className="space-y-3">
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-muted-foreground">
                CodeSentinel Report
              </p>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
                {report.repository.name}
              </h1>
              <p className="max-w-2xl font-mono text-sm text-muted-foreground">
                {report.repository.targetPath}
              </p>
            </div>
            <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
              <div>
                <span className="block text-xs uppercase tracking-[0.18em]">Generated</span>
                <span className="mt-1 block text-foreground">
                  {formatTimestamp(report.generatedAt)}
                </span>
              </div>
              <div>
                <span className="block text-xs uppercase tracking-[0.18em]">Snapshot</span>
                <span className="mt-1 block text-foreground">
                  {formatTimestamp(report.appendix.timestamp)}
                </span>
              </div>
              <div>
                <span className="block text-xs uppercase tracking-[0.18em]">Confidence</span>
                <span className="mt-1 block text-foreground">
                  {formatScore(
                    report.repository.confidence === null
                      ? null
                      : report.repository.confidence * 100,
                  )}
                </span>
              </div>
            </div>
          </div>
          <Card className="bg-slate-950 text-slate-50">
            <CardHeader>
              <CardDescription className="text-slate-300">Quick read</CardDescription>
              <CardTitle className="text-2xl text-white">
                {report.hotspots.length} hotspots,{" "}
                {externalAvailable ? report.external.riskyDependencies.length : 0} risky deps,{" "}
                {report.structural.cycleCount} cycles
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-300">
              <p>Dimension spread highlights where repository risk is concentrated right now.</p>
              <Separator className="bg-slate-800" />
              <div className="grid gap-3">
                <DimensionBar
                  label="Structural"
                  value={report.repository.dimensionScores.structural}
                />
                <DimensionBar
                  label="Evolution"
                  value={report.repository.dimensionScores.evolution}
                />
                <DimensionBar label="External" value={report.repository.dimensionScores.external} />
                <DimensionBar
                  label="Interactions"
                  value={report.repository.dimensionScores.interactions}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Repository risk"
          value={formatScore(report.repository.riskScore)}
          badge={
            <Badge variant={badgeVariantForRisk(report.repository.riskTier)}>
              {report.repository.riskTier.replaceAll("_", " ")}
            </Badge>
          }
          description="Deterministic 0-100 score combining structural, change, dependency, and interaction factors."
          icon={<ShieldAlert className="h-5 w-5" />}
        />
        <MetricCard
          title="Repository health"
          value={formatScore(report.health.healthScore)}
          badge={
            <Badge variant={healthVariant(report.health.healthScore)}>
              {report.repository.healthTier}
            </Badge>
          }
          description="Health view summarizing modularity, change hygiene, ownership distribution, and test signals."
          icon={<HeartPulse className="h-5 w-5" />}
        />
        <MetricCard
          title="Hotspots"
          value={String(report.hotspots.length)}
          badge={
            <Badge
              variant={
                report.hotspots.length >= 8
                  ? "danger"
                  : report.hotspots.length >= 4
                    ? "warning"
                    : "success"
              }
            >
              ranked
            </Badge>
          }
          description="Top files where repository risk is most concentrated."
          icon={<Flame className="h-5 w-5" />}
        />
        <MetricCard
          title="Risky dependencies"
          value={String(externalAvailable ? report.external.riskyDependencies.length : 0)}
          badge={
            <Badge
              variant={
                externalAvailable && report.external.riskyDependencies.length > 0
                  ? "warning"
                  : "success"
              }
            >
              {externalAvailable ? "available" : "unavailable"}
            </Badge>
          }
          description={
            externalAvailable
              ? "Top dependency entries with direct or inherited risk signals."
              : "Dependency analysis was not available for this repository."
          }
          icon={<PackageSearch className="h-5 w-5" />}
        />
      </section>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="hotspots">Hotspots</TabsTrigger>
          <TabsTrigger value="structure">Structure</TabsTrigger>
          <TabsTrigger value="dependencies">Dependencies</TabsTrigger>
          <TabsTrigger value="diff">Diff</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <Card>
              <CardHeader>
                <CardTitle>Dimension breakdown</CardTitle>
                <CardDescription>
                  Repository-level dimension scores from the risk trace.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <DimensionBar
                  label="Structural"
                  value={report.repository.dimensionScores.structural}
                />
                <DimensionBar
                  label="Evolution"
                  value={report.repository.dimensionScores.evolution}
                />
                <DimensionBar label="External" value={report.repository.dimensionScores.external} />
                <DimensionBar
                  label="Interactions"
                  value={report.repository.dimensionScores.interactions}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Top health issues</CardTitle>
                <CardDescription>
                  Highest-priority repository health concerns emitted by the health engine.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {report.health.topIssues.length === 0 ? (
                  <EmptyState
                    title="No health issues surfaced"
                    description="The current snapshot did not emit any top health issues."
                  />
                ) : (
                  report.health.topIssues.slice(0, 6).map((issue) => (
                    <div
                      key={`${issue.id}:${issue.target}`}
                      className="rounded-2xl border border-border/60 bg-background/80 p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={issueVariant(issue.severity)}>{issue.severity}</Badge>
                        <Badge variant="outline">{issue.dimension}</Badge>
                      </div>
                      <p className="mt-3 text-sm font-medium">{issue.message}</p>
                      <p className="mt-2 font-mono text-xs text-muted-foreground">{issue.target}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </section>
        </TabsContent>

        <TabsContent value="hotspots">
          {report.hotspots.length === 0 ? (
            <EmptyState
              title="No hotspots ranked"
              description="Risk analysis did not produce hotspot entries for this repository."
            />
          ) : (
            <HotspotsTable items={report.hotspots} />
          )}
        </TabsContent>

        <TabsContent value="structure" className="space-y-6">
          <section className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Fan-in extremes</CardTitle>
                <CardDescription>
                  Files with the highest incoming dependency concentration.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {report.structural.fanInOutExtremes.highestFanIn.map((item) => (
                  <div
                    key={item.file}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-4 py-3"
                  >
                    <div>
                      <p className="font-medium">{item.file}</p>
                      <p className="font-mono text-xs text-muted-foreground">{item.module}</p>
                    </div>
                    <span className="font-mono text-sm">{item.value}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Fan-out extremes</CardTitle>
                <CardDescription>
                  Files creating the widest direct dependency spread.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {report.structural.fanInOutExtremes.highestFanOut.map((item) => (
                  <div
                    key={item.file}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-4 py-3"
                  >
                    <div>
                      <p className="font-medium">{item.file}</p>
                      <p className="font-mono text-xs text-muted-foreground">{item.module}</p>
                    </div>
                    <span className="font-mono text-sm">{item.value}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Depth extremes</CardTitle>
                <CardDescription>Files deepest in the structural graph.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {report.structural.fanInOutExtremes.deepestFiles.map((item) => (
                  <div
                    key={item.file}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-4 py-3"
                  >
                    <div>
                      <p className="font-medium">{item.file}</p>
                      <p className="font-mono text-xs text-muted-foreground">{item.module}</p>
                    </div>
                    <span className="font-mono text-sm">{item.value}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>

          <Accordion type="multiple" className="space-y-4">
            <AccordionItem value="cycles">
              <AccordionTrigger>Cycles ({report.structural.cycleCount})</AccordionTrigger>
              <AccordionContent className="space-y-3">
                {report.structural.cycleDetails.length === 0 ? (
                  <p>No structural cycles detected.</p>
                ) : (
                  report.structural.cycleDetails.map((cycle) => (
                    <div
                      key={cycle.id}
                      className="rounded-xl border border-border/60 bg-background/80 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">{cycle.id}</p>
                        <Badge variant={cycle.size >= 4 ? "danger" : "warning"}>
                          {cycle.size} nodes
                        </Badge>
                      </div>
                      <p className="mt-3 font-mono text-xs text-muted-foreground">{cycle.path}</p>
                    </div>
                  ))
                )}
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="clusters">
              <AccordionTrigger>
                Fragile clusters ({report.structural.fragileClusters.length})
              </AccordionTrigger>
              <AccordionContent className="space-y-3">
                {report.structural.fragileClusters.length === 0 ? (
                  <p>No fragile clusters detected.</p>
                ) : (
                  report.structural.fragileClusters.map((cluster) => (
                    <div
                      key={cluster.id}
                      className="rounded-xl border border-border/60 bg-background/80 p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={cluster.score >= 70 ? "danger" : "warning"}>
                          {formatScore(cluster.score)}
                        </Badge>
                        <Badge variant="outline">{cluster.kind}</Badge>
                      </div>
                      <p className="mt-3 text-sm font-medium">{cluster.id}</p>
                      <p className="mt-2 font-mono text-xs text-muted-foreground">
                        {cluster.files.join(" • ")}
                      </p>
                    </div>
                  ))
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </TabsContent>

        <TabsContent value="dependencies">
          {!externalAvailable ? (
            <EmptyState
              title="Dependency analysis unavailable"
              description={`CodeSentinel could not compute dependency exposure for this snapshot: ${report.external.reason}.`}
            />
          ) : report.external.riskyDependencies.length === 0 ? (
            <EmptyState
              title="No risky dependencies ranked"
              description="Dependency analysis completed, but no dependency entries were ranked as risky in the report."
            />
          ) : (
            <DependenciesTable items={report.external.riskyDependencies} />
          )}
        </TabsContent>

        <TabsContent value="diff" className="space-y-6">
          {report.diff === undefined ? (
            <EmptyState
              title="No diff available"
              description="Generate the report with a baseline snapshot to see regressions, new hotspots, and score deltas."
            />
          ) : (
            <>
              <section className="grid gap-4 md:grid-cols-3">
                <MetricCard
                  title="Risk delta"
                  value={formatScore(report.diff.riskScoreDelta)}
                  badge={
                    <Badge variant={report.diff.riskScoreDelta > 0 ? "danger" : "success"}>
                      {report.diff.riskScoreDelta > 0 ? "regression" : "improved"}
                    </Badge>
                  }
                  description="Change in absolute repository risk score versus the baseline snapshot."
                  icon={<GitCompareArrows className="h-5 w-5" />}
                />
                <MetricCard
                  title="New hotspots"
                  value={String(report.diff.newHotspots.length)}
                  badge={
                    <Badge variant={report.diff.newHotspots.length > 0 ? "warning" : "success"}>
                      hotspots
                    </Badge>
                  }
                  description="Hotspots now present in the current top 10 ranking but absent from the baseline."
                  icon={<Flame className="h-5 w-5" />}
                />
                <MetricCard
                  title="New cycles"
                  value={String(report.diff.newCycles.length)}
                  badge={
                    <Badge variant={report.diff.newCycles.length > 0 ? "danger" : "success"}>
                      cycles
                    </Badge>
                  }
                  description="New structural cycles introduced since the baseline snapshot."
                  icon={<Workflow className="h-5 w-5" />}
                />
              </section>
              <section className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Regressions</CardTitle>
                    <CardDescription>
                      New hotspots and cycles relative to the comparison snapshot.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        New hotspots
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {report.diff.newHotspots.length === 0 ? (
                          <Badge variant="outline">none</Badge>
                        ) : (
                          report.diff.newHotspots.map((item) => (
                            <Badge key={item} variant="warning">
                              {item}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        New cycles
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {report.diff.newCycles.length === 0 ? (
                          <Badge variant="outline">none</Badge>
                        ) : (
                          report.diff.newCycles.map((item) => (
                            <Badge key={item} variant="danger">
                              {item}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Resolved issues</CardTitle>
                    <CardDescription>
                      Items present in the baseline but removed from the current snapshot.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Resolved hotspots
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {report.diff.resolvedHotspots.length === 0 ? (
                          <Badge variant="outline">none</Badge>
                        ) : (
                          report.diff.resolvedHotspots.map((item) => (
                            <Badge key={item} variant="success">
                              {item}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Resolved cycles
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {report.diff.resolvedCycles.length === 0 ? (
                          <Badge variant="outline">none</Badge>
                        ) : (
                          report.diff.resolvedCycles.map((item) => (
                            <Badge key={item} variant="success">
                              {item}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>
            </>
          )}
        </TabsContent>
      </Tabs>

      <footer className="pb-6 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          <span>{report.appendix.normalization}</span>
        </div>
      </footer>
    </main>
  );
};
