import { Check, CircleDot, Sparkles, UserRoundSearch, X, type LucideIcon } from "lucide-react";

import { LocalTime } from "@/components/ui/local-time";
import { CATEGORY_LABELS, isComplaintCategory } from "@/features/complaints/categories";
import type { Department } from "@/features/complaints/repository";
import { PRIORITY_LABELS } from "@/features/complaints/statuses";
import { cn } from "@/lib/utils/cn";

import { FAILURE_LABELS } from "../failures";
import type { AgentRunView, RunOutcome, RunTraceEntry } from "../runs";
import { RetryAiForm } from "./retry-ai-form";

const OUTCOMES: Readonly<Record<RunOutcome, { label: string; className: string }>> = {
  routed: { label: "Routed automatically", className: "bg-success-soft text-success" },
  needs_review: { label: "Sent for review", className: "bg-accent-soft text-accent-ink" },
  superseded: { label: "Superseded", className: "bg-surface-muted text-ink-muted" },
  running: { label: "Running", className: "bg-brand-soft text-brand-strong" },
};

const VERDICTS: Readonly<
  Record<RunTraceEntry["verdict"], { icon: LucideIcon; label: string; className: string }>
> = {
  ok: { icon: Check, label: "answered", className: "text-ink-muted" },
  accepted: { icon: Check, label: "accepted", className: "text-success" },
  rejected: { icon: X, label: "rejected", className: "text-danger" },
  review: { icon: UserRoundSearch, label: "sent for review", className: "text-accent-ink" },
};

function duration(ms: number | null): string | null {
  if (ms === null) return null;
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function TraceLine({
  entry,
  departments,
}: {
  readonly entry: RunTraceEntry;
  readonly departments: ReadonlyMap<string, string>;
}) {
  const verdict = VERDICTS[entry.verdict];
  const Icon = verdict.icon;
  const details = [
    entry.category !== undefined && isComplaintCategory(entry.category)
      ? CATEGORY_LABELS[entry.category]
      : null,
    entry.departmentId === undefined
      ? null
      : (departments.get(entry.departmentId) ?? "unknown department id"),
    entry.priority === undefined ? null : `${entry.priority} priority`,
  ].filter((part) => part !== null);
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className="mt-0.5 w-5 shrink-0 font-mono text-xs text-ink-subtle">{entry.step}</span>
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", verdict.className)} />
      <span className="min-w-0">
        <code className="font-mono text-xs text-ink">{entry.tool}</code>{" "}
        <span className={verdict.className}>{verdict.label}</span>
        {entry.code === undefined ? null : (
          <span className="ml-1.5 rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[0.7rem] text-ink-muted">
            {entry.code}
          </span>
        )}
        {details.length === 0 ? null : (
          <span className="block text-ink-muted">{details.join(" · ")}</span>
        )}
      </span>
    </li>
  );
}

function RunCard({
  run,
  departments,
}: {
  readonly run: AgentRunView;
  readonly departments: ReadonlyMap<string, string>;
}) {
  const outcome = OUTCOMES[run.outcome];
  const meta = [run.model, run.promptVersion, duration(run.durationMs)].filter(
    (part) => part !== null,
  );
  const suggestion = [
    run.proposal.category !== null && isComplaintCategory(run.proposal.category)
      ? CATEGORY_LABELS[run.proposal.category]
      : null,
    run.proposal.departmentId === null
      ? null
      : (departments.get(run.proposal.departmentId) ?? null),
    run.proposal.priority === null ? null : `${PRIORITY_LABELS[run.proposal.priority]} priority`,
  ].filter((part) => part !== null);

  return (
    <article
      className="space-y-3 rounded-xl border border-line p-4"
      aria-label={`AI attempt: ${outcome.label}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", outcome.className)}>
          {outcome.label}
        </span>
        <span className="text-xs text-ink-muted">
          {run.trigger === "admin_retry" ? "Admin retry" : "On submission"} ·{" "}
          <LocalTime value={run.startedAt} />
        </span>
      </div>
      {run.failureCode === null ? null : (
        <p className="text-sm text-ink">{FAILURE_LABELS[run.failureCode]}</p>
      )}
      {run.outcome !== "routed" && suggestion.length > 0 ? (
        <p className="text-sm text-ink-muted">Model suggested: {suggestion.join(" · ")}</p>
      ) : null}
      {run.trace.length === 0 ? null : (
        <ol aria-label="Tool calls" className="space-y-1.5 border-l-2 border-line pl-3">
          {run.trace.map((entry, index) => (
            <TraceLine key={index} entry={entry} departments={departments} />
          ))}
        </ol>
      )}
      <p className="font-mono text-[0.7rem] text-ink-subtle">{meta.join(" · ")}</p>
    </article>
  );
}

/**
 * The AI attempts on a ticket for administrators (plan §20 evidence: a tool call and a
 * rejected tool call), with the bounded retry when the ticket is waiting for routing.
 */
export function AgentRunsPanel({
  ticketId,
  runs,
  departments,
  aiEnabled,
  canRetry,
}: {
  readonly ticketId: string;
  readonly runs: readonly AgentRunView[];
  readonly departments: readonly Department[];
  readonly aiEnabled: boolean;
  readonly canRetry: boolean;
}) {
  const names = new Map(departments.map((department) => [department.id, department.name]));
  return (
    <section
      aria-label="AI routing"
      className="animate-fade-up space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-soft"
    >
      <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
        <Sparkles aria-hidden="true" className="size-5 text-brand" />
        AI routing
      </h2>
      {runs.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <CircleDot aria-hidden="true" className="size-4" />
          {aiEnabled
            ? "No AI attempt yet for this ticket."
            : "AI routing is switched off; route this ticket manually."}
        </p>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => (
            <RunCard key={run.id} run={run} departments={names} />
          ))}
        </div>
      )}
      {aiEnabled && canRetry ? (
        <RetryAiForm
          ticketId={ticketId}
          label={runs.length === 0 ? "Run AI routing" : "Retry AI routing"}
        />
      ) : null}
    </section>
  );
}
