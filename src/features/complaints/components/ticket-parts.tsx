import { cn } from "@/lib/utils/cn";

import { PRIORITY_LABELS, type TicketPriority } from "../statuses";

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

/** A ticket the department has not acknowledged yet. */
export function NewMarker() {
  return (
    <span className="inline-flex h-6 items-center rounded-md bg-accent-soft px-2 text-xs font-medium text-accent-ink">
      New
    </span>
  );
}

/** An AI attempt that stopped before finishing (admin review). */
export function StalledMarker() {
  return (
    <span className="inline-flex h-6 items-center rounded-md bg-danger-soft px-2 text-xs font-medium text-danger">
      AI stalled
    </span>
  );
}
