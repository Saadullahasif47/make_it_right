import { CirclePlus, type LucideIcon } from "lucide-react";

import { LocalTime } from "@/components/ui/local-time";

import type { TimelineEvent } from "../repository";
import { STATUS_LABELS } from "../statuses";

/** Automated actors are always named, so a reader never mistakes them for a person. */
const ACTOR_LABELS: Readonly<Record<TimelineEvent["actorKind"], string | null>> = {
  user: null,
  agent: "AI assistant",
  rule: "Rule-based routing",
  system: "MakeItRight",
};

const EVENT_PRESENTATION: Readonly<
  Record<TimelineEvent["type"], { icon: LucideIcon; title: (event: TimelineEvent) => string }>
> = {
  created: { icon: CirclePlus, title: () => "Report submitted" },
};

/** Append-only history of a ticket, oldest first (plan §6, BR-04). */
export function Timeline({ events }: { readonly events: readonly TimelineEvent[] }) {
  return (
    <ol aria-label="Ticket history" className="relative space-y-6">
      {events.map((event, index) => {
        const { icon: Icon, title } = EVENT_PRESENTATION[event.type];
        const actor = ACTOR_LABELS[event.actorKind];
        const isLast = index === events.length - 1;
        return (
          <li
            key={event.id}
            className="relative flex animate-step-in gap-4"
            style={{ animationDelay: `${index * 80}ms` }}
          >
            {isLast ? null : (
              <span
                aria-hidden="true"
                className="absolute top-9 bottom-[-1.5rem] left-[17px] w-px bg-line"
              />
            )}
            <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-strong ring-4 ring-surface">
              <Icon aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0 pt-1">
              <p className="font-semibold text-ink">{title(event)}</p>
              <p className="mt-0.5 text-sm text-ink-muted">
                {actor === null ? null : `${actor} · `}
                <LocalTime value={event.createdAt} />
              </p>
              {event.newStatus === null ? null : (
                <p className="mt-1 text-sm text-ink-muted">
                  Status: {STATUS_LABELS[event.newStatus]}
                </p>
              )}
              {event.note === null ? null : (
                <p className="mt-2 rounded-xl bg-surface-muted px-3 py-2 text-sm whitespace-pre-wrap text-ink">
                  {event.note}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
