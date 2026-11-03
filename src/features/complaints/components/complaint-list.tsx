import { ChevronRight, MapPin } from "lucide-react";
import Link from "next/link";

import { LocalTime } from "@/components/ui/local-time";
import { cn } from "@/lib/utils/cn";

import type { ComplaintSummary } from "../repository";
import { PRIORITY_LABELS, type TicketPriority } from "../statuses";
import { ACKNOWLEDGEABLE_STATES, isStalledTriage } from "../workflow";

import { StatusBadge } from "./status-badge";

export function locationOf(complaint: {
  readonly building: string;
  readonly room: string | null;
}): string {
  return complaint.room === null
    ? complaint.building
    : `${complaint.building}, room ${complaint.room}`;
}

const PRIORITY_LEVELS: Readonly<Record<TicketPriority, number>> = {
  unassessed: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/** Priority as a three-bar signal plus its label; only "high" uses the attention colour. */
export function PriorityBadge({ priority }: { readonly priority: TicketPriority }) {
  const level = PRIORITY_LEVELS[priority];
  const high = priority === "high";
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-medium whitespace-nowrap",
        high ? "border-accent/40 bg-accent-soft text-accent-ink" : "border-line text-ink-muted",
      )}
    >
      <span aria-hidden="true" className="flex h-2.5 items-end gap-px">
        {[1, 2, 3].map((bar) => (
          <span
            key={bar}
            className={cn(
              "w-[3px] rounded-[1px]",
              bar === 1 ? "h-1" : bar === 2 ? "h-1.5" : "h-2.5",
              bar <= level ? (high ? "bg-accent" : "bg-ink-muted") : "bg-line-strong",
            )}
          />
        ))}
      </span>
      {priority === "unassessed" ? "Priority not set" : `${PRIORITY_LABELS[priority]} priority`}
    </span>
  );
}

/**
 * Ticket list. The "staff" variant adds what a queue needs at a glance: priority, a "New"
 * marker on tickets the department has not acknowledged yet, and (given `now`) a marker on
 * AI attempts that stopped before finishing.
 */
export function ComplaintList({
  complaints,
  hrefFor,
  variant = "reporter",
  now,
}: {
  readonly complaints: readonly ComplaintSummary[];
  readonly hrefFor: (id: string) => string;
  readonly variant?: "reporter" | "staff";
  /** Request time, when the list should flag AI attempts that have stalled (admin review). */
  readonly now?: number;
}) {
  return (
    <ul aria-label="Complaints" className="space-y-3">
      {complaints.map((complaint) => {
        const isNew =
          variant === "staff" &&
          complaint.acknowledgedAt === null &&
          ACKNOWLEDGEABLE_STATES.includes(complaint.status);
        const isStalled = now !== undefined && isStalledTriage(complaint, now);
        return (
          <li key={complaint.id}>
            <Link
              href={hrefFor(complaint.id)}
              className="group flex items-center gap-4 rounded-xl border border-line bg-surface p-4 shadow-soft transition-[transform,box-shadow,border-color] duration-150 hover:border-brand/40 sm:p-5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="font-mono text-xs font-semibold text-ink-subtle">
                    {complaint.reference}
                  </span>
                  <StatusBadge status={complaint.status} />
                  {variant === "staff" ? <PriorityBadge priority={complaint.priority} /> : null}
                  {isNew ? (
                    <span className="inline-flex h-6 items-center gap-1 rounded-md bg-accent-soft px-2 text-xs font-medium text-accent-ink">
                      New
                    </span>
                  ) : null}
                  {isStalled ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">
                      AI stalled
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 truncate font-semibold text-ink group-hover:text-brand-strong">
                  {complaint.title}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
                  <span className="inline-flex items-center gap-1">
                    <MapPin aria-hidden="true" className="size-3.5" />
                    {locationOf(complaint)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Reported <LocalTime value={complaint.createdAt} />
                  </span>
                </p>
              </div>
              <ChevronRight
                aria-hidden="true"
                className="size-5 shrink-0 text-ink-subtle group-hover:text-brand"
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
