import type { CodeSentinelReport } from "@codesentinel/reporter";
import { createHealthPostureViewModel, formatScore } from "../app/report-data";
import { PageIntro } from "../components/design/page-intro";
import { MaterialSymbol } from "../components/material-symbol";
import { cn } from "../lib/utils";

type HealthPostureScreenProps = {
  report: CodeSentinelReport;
};

const clampPercent = (value: number | null | undefined): number =>
  Math.max(0, Math.min(100, Math.round(value ?? 0)));

const donutDashOffset = (score: number): number => {
  const circumference = 2 * Math.PI * 80;
  return circumference - (circumference * clampPercent(score)) / 100;
};

const pageDescription =
  "A health posture view across modularity, change hygiene, test signals, and ownership distribution.";

export const HealthPostureScreen = ({ report }: HealthPostureScreenProps) => {
  const viewModel = createHealthPostureViewModel(report);
  const issues = viewModel.priorityIssues;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 p-4 md:p-8">
      <PageIntro
        description={pageDescription}
        label="Repository Health"
        labelClassName="text-tertiary"
        title="Health Posture"
      />

      <section className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
        <div className="self-start flex flex-col items-center rounded-xl bg-surface-container-lowest p-8 text-center lg:col-span-4">
          <p className="mb-6 text-[0.6875rem] font-bold uppercase tracking-widest text-on-surface-variant">
            Overall Health Score
          </p>
          <div className="relative flex h-48 w-48 items-center justify-center">
            <svg className="h-full w-full -rotate-90" viewBox="0 0 192 192">
              <circle
                className="text-surface-container-low"
                cx="96"
                cy="96"
                fill="transparent"
                r="80"
                stroke="currentColor"
                strokeWidth="12"
              />
              <circle
                className="text-tertiary-fixed transition-all duration-1000"
                cx="96"
                cy="96"
                fill="transparent"
                r="80"
                stroke="currentColor"
                strokeDasharray={2 * Math.PI * 80}
                strokeDashoffset={donutDashOffset(report.health.healthScore)}
                strokeLinecap="round"
                strokeWidth="12"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[3.5rem] font-semibold tracking-tight text-on-surface">
                {formatScore(report.health.healthScore)}
              </span>
              <span className="text-sm font-medium text-on-surface-variant">/ 100</span>
            </div>
          </div>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-tertiary-container/10 px-3 py-1 text-xs font-semibold text-tertiary-fixed">
            <MaterialSymbol className="text-sm" icon="trending_up" />
            {viewModel.trendChipLabel}
          </div>
          <p className="mt-6 px-4 text-sm leading-relaxed text-on-surface-variant">
            {viewModel.heroDescription}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:col-span-8">
          {viewModel.dimensionCards.map((card) => (
            <div
              className={cn(
                "rounded-xl border-l-4 bg-surface-container-low p-6",
                card.accentClassName,
              )}
              key={card.title}
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-container-lowest">
                  <MaterialSymbol
                    className={cn("text-[20px]", card.iconClassName)}
                    icon={card.icon}
                  />
                </div>
                <span className="text-xs font-bold text-on-surface-variant">
                  {card.metricLabel}: <span className="text-on-surface">{card.metricValue}</span>
                </span>
              </div>
              <h3 className="mb-1 text-[1.125rem] font-semibold text-on-surface">{card.title}</h3>
              <p className="mb-4 text-xs text-on-surface-variant">{card.description}</p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-lowest">
                {card.meterPercent > 0 ? (
                  <div
                    className={cn("h-full rounded-full", card.barClassName)}
                    style={{ width: `${card.meterPercent}%` }}
                  />
                ) : null}
              </div>
              <p className={cn("mt-3 text-xs font-medium", card.statusClassName)}>{card.status}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-6">
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-on-surface">
              Top Health Issues &amp; Action Plan
            </h2>
            <div className="rounded bg-tertiary-fixed/10 px-2 py-1 text-xs font-bold text-tertiary-fixed">
              {issues.length} Priority Actions
            </div>
          </div>

          <div className="space-y-4">
            {(issues.length > 0 ? issues : viewModel.fallbackIssues).map((issue) => (
              <div
                className="group rounded-xl bg-surface-container-lowest p-6 transition-shadow hover:shadow-md"
                key={`${issue.title}-${issue.copy}`}
              >
                <div className="flex gap-6">
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        "mb-2 rounded-full px-2 py-0.5 text-[0.6875rem] font-bold",
                        issue.severityClassName,
                      )}
                    >
                      {issue.severity}
                    </span>
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-container-low">
                      <MaterialSymbol className="text-on-surface-variant" icon={issue.icon} />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="mb-1 font-semibold text-on-surface">{issue.title}</h4>
                    <p className="mb-4 text-sm text-on-surface-variant">{issue.copy}</p>
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="flex gap-2">
                        {issue.tags.map((tag) => (
                          <span
                            className="rounded bg-surface-container-low px-2 py-1 text-[0.625rem] font-bold uppercase text-on-surface"
                            key={tag}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <button
                        className="hidden items-center gap-1 text-xs font-semibold text-tertiary transition-all group-hover:gap-2"
                        tabIndex={-1}
                        type="button"
                      >
                        {issue.cta}
                        <MaterialSymbol className="text-sm" icon="arrow_forward" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
};
