import {
  Activity,
  CircleCheck,
  Hourglass,
  ListChecks,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { FAILURE_LABELS, isRunRecordCode } from "@/features/agent/failures";
import { STATUS_LABELS, TICKET_STATES } from "@/features/complaints/statuses";
import { cn } from "@/lib/utils/cn";

import { METRIC_WINDOWS, type AdminMetrics, type MetricWindow } from "../metrics";

/* ------------------------------------------------------------------------------------------ */
/* Formatting                                                                                  */
/* ------------------------------------------------------------------------------------------ */

export function formatHours(hours: number | null): string {
  if (hours === null) return "–";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

function formatMs(ms: number | null): string {
  if (ms === null) return "–";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function percent(part: number, whole: number): string {
  return whole === 0 ? "–" : `${Math.round((part / whole) * 100)}%`;
}

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/* ------------------------------------------------------------------------------------------ */
/* Building blocks                                                                             */
/* ------------------------------------------------------------------------------------------ */

function Panel({
  title,
  description,
  children,
  className,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  const id = `panel-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section
      aria-labelledby={id}
      className={cn("rounded-xl border border-line bg-surface p-6 shadow-soft", className)}
    >
      <h2 id={id} className="text-base font-semibold text-ink">
        {title}
      </h2>
      {description === undefined ? null : (
        <p className="mt-1 text-sm text-ink-muted">{description}</p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function KpiTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
}: {
  readonly label: string;
  readonly value: string;
  readonly hint: string;
  readonly icon: LucideIcon;
  readonly tone?: "neutral" | "attention";
}) {
  return (
    <div className="group rounded-xl border border-line bg-surface p-5 shadow-soft transition-[transform,box-shadow,border-color] duration-150 hover:border-brand/40">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink-muted">{label}</p>
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-lg transition-colors duration-150",
            tone === "attention"
              ? "bg-accent-soft text-accent-ink"
              : "bg-brand-soft text-brand-strong",
          )}
        >
          <Icon aria-hidden="true" className="size-4" />
        </span>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-ink tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-ink-muted">{hint}</p>
    </div>
  );
}

/** Horizontal bars with direct labels: the list itself is the accessible table. */
function BarList({
  label,
  rows,
  wideLabels = false,
}: {
  readonly label: string;
  readonly rows: readonly {
    readonly key: string;
    readonly label: string;
    readonly value: number;
  }[];
  /** Long labels (sentences) wrap beside a shorter bar instead of being cut off. */
  readonly wideLabels?: boolean;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul aria-label={label} className="space-y-2.5">
      {rows.map((row) => (
        <li
          key={row.key}
          className={cn(
            "grid items-center gap-3 text-sm",
            wideLabels ? "grid-cols-[minmax(0,1fr)_4.5rem_2rem]" : "grid-cols-[8.5rem_1fr_2.5rem]",
          )}
        >
          <span className={cn("text-ink-muted", wideLabels ? "leading-snug" : "truncate")}>
            {row.label}
          </span>
          <span className="h-2.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
            <span
              className="block h-full rounded-full bg-brand transition-[width] duration-200"
              style={{ width: `${(row.value / max) * 100}%` }}
            />
          </span>
          <span className="text-right font-semibold text-ink tabular-nums">{row.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** Fourteen daily columns; a hidden table carries the same numbers for assistive technology. */
function DailyColumns({ days }: { readonly days: AdminMetrics["createdPerDay"] }) {
  const max = Math.max(1, ...days.map((day) => day.count));
  return (
    <figure>
      <div className="flex h-36 items-end gap-1.5" aria-hidden="true">
        {days.map((day) => (
          <div
            key={day.day}
            className="group flex h-full flex-1 flex-col justify-end"
            title={`${dayFormat.format(new Date(day.day))}: ${day.count}`}
          >
            {day.count > 0 ? (
              <span className="mb-1 text-center text-[0.7rem] font-semibold text-ink tabular-nums">
                {day.count}
              </span>
            ) : null}
            <span
              className={cn(
                "block rounded-t-md transition-colors duration-150 group-hover:bg-brand-strong",
                day.count === 0 ? "h-0.5 bg-line" : "bg-brand",
              )}
              style={
                day.count === 0 ? undefined : { height: `${Math.max(6, (day.count / max) * 100)}%` }
              }
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5 text-[0.65rem] text-ink-subtle" aria-hidden="true">
        {days.map((day, index) => (
          <span key={day.day} className="flex-1 text-center">
            {index % 3 === 1 || index === days.length - 1
              ? dayFormat.format(new Date(day.day))
              : ""}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Reports created per day, last 14 days</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Reports</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.day}>
              <td>{dayFormat.format(new Date(day.day))}</td>
              <td>{day.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Window filter                                                                               */
/* ------------------------------------------------------------------------------------------ */

export function WindowFilter({ active }: { readonly active: MetricWindow }) {
  return (
    <nav aria-label="Reporting period">
      <ul className="flex flex-wrap gap-2">
        {METRIC_WINDOWS.map((window) => (
          <li key={window}>
            <Link
              href={`/admin?window=${window}`}
              aria-current={window === active ? "page" : undefined}
              className={cn(
                "inline-flex items-center rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors duration-150",
                window === active
                  ? "border-brand bg-brand text-brand-fg"
                  : "border-line-strong bg-surface text-ink-muted hover:border-brand hover:text-ink",
              )}
            >
              Last {window} days
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* The dashboard                                                                               */
/* ------------------------------------------------------------------------------------------ */

export function MetricsDashboard({ metrics }: { readonly metrics: AdminMetrics }) {
  const { totals, routing, aging, resolution, ai } = metrics;
  const reviewReasons = Object.entries(ai.reviewReasons).sort(([, a], [, b]) => b - a);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Open tickets"
          value={String(totals.open)}
          hint={`${totals.all} in total · oldest open ${formatHours(aging.oldestOpenHours === 0 ? null : aging.oldestOpenHours)}`}
          icon={Activity}
        />
        <KpiTile
          label="Awaiting routing"
          value={String(routing.awaiting)}
          hint={
            routing.stalledTriage > 0
              ? `${routing.stalledTriage} AI attempt${routing.stalledTriage === 1 ? "" : "s"} stalled`
              : `${routing.needsReview} need${routing.needsReview === 1 ? "s" : ""} a human decision`
          }
          icon={ListChecks}
          tone={routing.awaiting > 0 ? "attention" : "neutral"}
        />
        <KpiTile
          label={`Resolved (${metrics.windowDays} days)`}
          value={String(resolution.resolvedInWindow)}
          hint={`Median time to resolve: ${formatHours(resolution.medianHours)}`}
          icon={CircleCheck}
        />
        <KpiTile
          label="Routed by AI"
          value={percent(ai.routed, ai.runs)}
          hint={
            ai.runs === 0
              ? "No AI attempts in this period"
              : `${ai.routed} of ${ai.runs} attempts · median ${formatMs(ai.p50Ms)}`
          }
          icon={Sparkles}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Tickets by status"
          description="Every ticket in the system, in lifecycle order."
        >
          <BarList
            label="Tickets by status"
            rows={TICKET_STATES.map((state) => ({
              key: state,
              label: STATUS_LABELS[state],
              value: metrics.statusCounts[state],
            }))}
          />
        </Panel>
        <Panel
          title="Age of open tickets"
          description="How long open tickets have been waiting since they were reported."
        >
          <BarList
            label="Age of open tickets"
            rows={[
              { key: "d0", label: "Under 1 day", value: aging.underOneDay },
              { key: "d1", label: "1 to 3 days", value: aging.oneToThreeDays },
              { key: "d3", label: "3 to 7 days", value: aging.threeToSevenDays },
              { key: "d7", label: "Over 7 days", value: aging.overSevenDays },
            ]}
          />
        </Panel>
      </div>

      <Panel
        title="New reports per day"
        description={`Last 14 days · ${totals.createdInWindow} reported and ${totals.closedInWindow} closed in the last ${metrics.windowDays} days.`}
      >
        <DailyColumns days={metrics.createdPerDay} />
      </Panel>

      <Panel
        title="Department workload"
        description="Open work per department; New means not yet acknowledged."
      >
        {/* Scrolls sideways on phones, so keyboard users must be able to focus it (WCAG 2.1.1). */}
        <div
          role="region"
          aria-label="Department workload table"
          tabIndex={0}
          className="-mx-6 overflow-x-auto rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="text-ink-muted">
              <tr className="border-b border-line">
                <th scope="col" className="px-6 py-2.5 font-semibold">
                  Department
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                  Open
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                  New
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                  In progress
                </th>
                <th scope="col" className="px-6 py-2.5 text-right font-semibold">
                  Resolved ({metrics.windowDays} d)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {metrics.departments.map((department) => (
                <tr key={department.id} className="transition-colors duration-150 hover:bg-canvas">
                  <td className="px-6 py-3 font-medium text-ink">
                    {department.name}
                    {department.isActive ? null : (
                      <span className="ml-2 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-ink-muted">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold text-ink tabular-nums">
                    {department.open}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {department.unacknowledged > 0 ? (
                      <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-ink">
                        {department.unacknowledged}
                      </span>
                    ) : (
                      <span className="text-ink-subtle">0</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right text-ink tabular-nums">
                    {department.inProgress}
                  </td>
                  <td className="px-6 py-3 text-right text-ink tabular-nums">
                    {department.resolvedInWindow}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="AI routing"
        description={`Attempts in the last ${metrics.windowDays} days. Anything the AI should not decide alone goes to the review queue.`}
      >
        {ai.runs === 0 ? (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <Hourglass aria-hidden="true" className="size-4" />
            No AI attempts in this period.
          </p>
        ) : (
          <div className="grid gap-6 md:grid-cols-[1fr_1.2fr]">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              {[
                ["Attempts", String(ai.runs)],
                ["Routed automatically", String(ai.routed)],
                ["Sent for review", String(ai.needsReview)],
                ["Response p50 / p95", `${formatMs(ai.p50Ms)} / ${formatMs(ai.p95Ms)}`],
              ].map(([term, detail]) => (
                <div key={term} className="rounded-xl bg-surface-muted px-4 py-3">
                  <dt className="text-xs text-ink-muted">{term}</dt>
                  <dd className="mt-1 text-lg font-semibold text-ink tabular-nums">{detail}</dd>
                </div>
              ))}
            </dl>
            <div>
              <h3 className="text-sm font-semibold text-ink">Why reports went to review</h3>
              {reviewReasons.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">None in this period.</p>
              ) : (
                <div className="mt-3">
                  <BarList
                    wideLabels
                    label="Review reasons"
                    rows={reviewReasons.map(([code, value]) => ({
                      key: code,
                      label: isRunRecordCode(code) ? FAILURE_LABELS[code] : code,
                      value,
                    }))}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
