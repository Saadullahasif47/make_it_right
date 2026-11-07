import { AlertTriangle, Info } from "lucide-react";
import Link from "next/link";

import { LocalTime } from "@/components/ui/local-time";
import { CATEGORY_LABELS, isComplaintCategory } from "@/features/complaints/categories";
import { cn } from "@/lib/utils/cn";

import { RULE_TEXT, describeAlert, type InsightAlert, type Insights } from "../schemas";

import { AcknowledgeAlert, SlaForm } from "./insight-forms";

const weekFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function Panel({
  id,
  title,
  description,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="rounded-xl border border-line bg-surface p-5">
      <h2 id={id} className="text-base font-semibold text-ink">
        {title}
      </h2>
      {description === undefined ? null : (
        <p className="mt-1 text-sm text-ink-muted">{description}</p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function AlertCard({ alert }: { readonly alert: InsightAlert }) {
  const text = RULE_TEXT[alert.rule_code];
  const Icon = alert.level === "warning" ? AlertTriangle : Info;
  return (
    <li className="space-y-3 rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Icon
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0",
            alert.level === "warning" ? "text-accent-ink" : "text-brand",
          )}
        />
        <h3 className="text-sm font-semibold text-ink">{text.title}</h3>
        <span className="text-sm text-ink-muted">
          {alert.asset === null
            ? (alert.location ?? alert.building_code ?? "")
            : `${alert.asset.code} · ${alert.location ?? ""}`}
        </span>
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-xs font-medium",
            alert.status === "acknowledged"
              ? "bg-surface-muted text-ink-muted"
              : "bg-accent-soft text-accent-ink",
          )}
        >
          {alert.status === "acknowledged" ? "Acknowledged" : "New"}
        </span>
      </div>
      <p className="text-sm text-ink">{describeAlert(alert)}</p>
      <p className="text-xs text-ink-muted">
        Rule: {text.rule} Window <LocalTime value={alert.window_start} /> to{" "}
        <LocalTime value={alert.window_end} />. {text.suggestion}
      </p>
      <div>
        <p className="text-xs font-medium text-ink-muted">
          Evidence: {alert.cases.length} distinct {alert.cases.length === 1 ? "case" : "cases"}
        </p>
        <ul aria-label="Evidence cases" className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {alert.cases.map((item) => (
            <li key={item.case_id}>
              {item.complaint_id === null ? (
                <span className="font-mono">{item.reference}</span>
              ) : (
                <Link
                  href={`/admin/complaints/${item.complaint_id}`}
                  className="font-mono underline decoration-line-strong underline-offset-4 hover:decoration-ink"
                >
                  {item.reference}
                </Link>
              )}
              <span className="text-xs text-ink-subtle">
                {" "}
                {item.status.replace("_", " ")}
                {item.synthetic ? ", demo" : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-ink-subtle">
        First seen <LocalTime value={alert.first_seen_at} />, last confirmed{" "}
        <LocalTime value={alert.last_seen_at} /> ({alert.refresh_count}{" "}
        {alert.refresh_count === 1 ? "check" : "checks"})
        {alert.acknowledged_at === null ? null : (
          <>
            {" "}
            · acknowledged <LocalTime value={alert.acknowledged_at} />
            {alert.acknowledgement_note === null ? "" : `: “${alert.acknowledgement_note}”`}
          </>
        )}
      </p>
      {alert.status === "open" ? <AcknowledgeAlert alertId={alert.id} /> : null}
    </li>
  );
}

/** Weekly distinct cases as SVG columns, with the numbers in a table for assistive technology. */
function WeeklyTrend({ trend }: { readonly trend: Insights["trend"] }) {
  const max = Math.max(1, ...trend.map((week) => week.cases));
  const width = 600;
  const height = 180;
  const gap = 8;
  const bar = (width - gap * (trend.length - 1)) / Math.max(1, trend.length);
  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${String(width)} ${String(height + 28)}`}
        className="w-full"
        aria-hidden="true"
      >
        {trend.map((week, index) => {
          const h = week.cases === 0 ? 2 : Math.max(6, (week.cases / max) * height);
          const x = index * (bar + gap);
          return (
            <g key={week.week_start}>
              <rect
                x={x}
                y={height - h}
                width={bar}
                height={h}
                rx={4}
                className={week.cases === 0 ? "fill-line" : "fill-brand"}
              />
              {week.cases > 0 ? (
                <text
                  x={x + bar / 2}
                  y={height - h - 6}
                  textAnchor="middle"
                  className="fill-ink text-[13px] font-semibold"
                >
                  {week.cases}
                </text>
              ) : null}
              {index % 2 === 0 || index === trend.length - 1 ? (
                <text
                  x={x + bar / 2}
                  y={height + 20}
                  textAnchor="middle"
                  className="fill-ink-subtle text-[12px]"
                >
                  {weekFormat.format(new Date(week.week_start))}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>Distinct cases opened per week</caption>
        <thead>
          <tr>
            <th scope="col">Week starting</th>
            <th scope="col">Cases</th>
          </tr>
        </thead>
        <tbody>
          {trend.map((week) => (
            <tr key={week.week_start}>
              <td>{weekFormat.format(new Date(week.week_start))}</td>
              <td>{week.cases}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/**
 * The insights page body (plan v2 F6.04): historical indicators from SQL over distinct cases,
 * each alert with its rule, window and the cases behind it. Not a prediction model.
 */
export function InsightsView({ insights }: { readonly insights: Insights }) {
  const max = Math.max(1, ...insights.ranked_assets.map((asset) => asset.cases));
  return (
    <div className="space-y-6">
      <Panel
        id="alerts-title"
        title={`Alerts (${String(insights.alerts.length)})`}
        description="Deterministic demo rules over the case history. They point at where to look; they do not predict failures."
      >
        {insights.alerts.length === 0 ? (
          <p className="text-sm text-ink-muted">No rule holds right now.</p>
        ) : (
          <ul className="space-y-3">
            {insights.alerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          id="assets-title"
          title="Equipment with the most cases"
          description="Distinct cases in the last 90 days."
        >
          {insights.ranked_assets.length === 0 ? (
            <p className="text-sm text-ink-muted">No equipment has cases in the last 90 days.</p>
          ) : (
            <ol aria-label="Equipment ranked by cases" className="space-y-2.5">
              {insights.ranked_assets.map((asset) => (
                <li
                  key={asset.asset_id}
                  className="grid grid-cols-[minmax(0,1fr)_5rem_2rem] items-center gap-3 text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-mono text-ink">{asset.code}</span>{" "}
                    <span className="text-ink-muted">
                      {asset.label}, {asset.location}
                    </span>
                  </span>
                  <span
                    className="h-2.5 overflow-hidden rounded-full bg-surface-muted"
                    aria-hidden="true"
                  >
                    <span
                      className="block h-full rounded-full bg-brand"
                      style={{ width: `${String((asset.cases / max) * 100)}%` }}
                    />
                  </span>
                  <span className="text-right font-semibold text-ink tabular-nums">
                    {asset.cases}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel
          id="trend-title"
          title="Cases per week"
          description="Distinct cases opened each week (all departments)."
        >
          <WeeklyTrend trend={insights.trend} />
        </Panel>
      </div>

      <Panel
        id="targets-title"
        title="Response-time targets"
        description="How long an assigned case may stay unresolved before 'Past its target' flags it. Demo defaults; change them to your service levels."
      >
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {insights.sla.map((target) => (
            <li key={target.category}>
              <SlaForm
                category={target.category}
                label={
                  isComplaintCategory(target.category)
                    ? CATEGORY_LABELS[target.category]
                    : target.category
                }
                targetDays={target.target_days}
              />
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
