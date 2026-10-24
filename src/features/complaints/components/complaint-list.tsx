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

const PRIORITY_CLASSES: Readonly<Record<TicketPriority, string>> = {
  high: "border-danger/30 text-danger",
  medium: "border-accent/40 text-accent-ink",
  low: "border-line-strong text-ink-muted",
  unassessed: "border-line text-ink-subtle",
};

export function PriorityBadge({ priority }: { readonly priority: TicketPriority }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        PRIORITY_CLASSES[priority],
      )}
    >
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
              className="group flex animate-fade-up items-center gap-4 rounded-2xl border border-line bg-surface p-4 shadow-soft transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lift sm:p-5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="font-mono text-xs font-semibold text-ink-subtle">
                    {complaint.reference}
                  </span>
                  <StatusBadge status={complaint.status} />
                  {variant === "staff" ? <PriorityBadge priority={complaint.priority} /> : null}
                  {isNew ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-ink">
                      New
                    </span>
                  ) : null}
                  {isStalled ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-bold text-danger">
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
                className="size-5 shrink-0 text-ink-subtle transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand"
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
