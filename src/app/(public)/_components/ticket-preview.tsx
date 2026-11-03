import { CirclePlus, Eye, MapPin, Route, Sparkles, Wrench, type LucideIcon } from "lucide-react";

import { PriorityBadge } from "@/features/complaints/components/complaint-list";
import { StatusBadge } from "@/features/complaints/components/status-badge";
import { cn } from "@/lib/utils/cn";

interface PreviewEvent {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly actor: string;
  readonly time: string;
  readonly note?: string;
  readonly tone: "brand" | "neutral";
}

/* The same titles, actors and order the real ticket timeline shows (timeline.tsx). */
const EVENTS: readonly PreviewEvent[] = [
  {
    icon: CirclePlus,
    title: "Report submitted",
    actor: "Reporter",
    time: "09:12",
    tone: "brand",
  },
  {
    icon: Sparkles,
    title: "AI routing started",
    actor: "AI assistant",
    time: "09:12",
    tone: "neutral",
  },
  {
    icon: Route,
    title: "Assigned to Electrical Maintenance",
    actor: "AI assistant",
    time: "09:12",
    note: "A ceiling fan that will not start is an electrical fault in a classroom.",
    tone: "brand",
  },
  {
    icon: Eye,
    title: "Acknowledged by the department",
    actor: "Department staff",
    time: "09:40",
    tone: "neutral",
  },
  {
    icon: Wrench,
    title: "Work started",
    actor: "Department staff",
    time: "10:05",
    note: "Replacing the capacitor this morning.",
    tone: "brand",
  },
];

/**
 * A static, faithful miniature of the student ticket page, built from the app's own badges.
 * Decorative: the hero copy says the same thing in words, so assistive technology skips it.
 */
export function TicketPreview() {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-xl border border-line bg-surface shadow-lift select-none"
    >
      <div className="flex items-center gap-1.5 border-b border-line bg-surface-muted px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="ml-3 truncate font-mono text-[11px] text-ink-subtle">
          Ticket · MakeItRight
        </span>
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-medium text-ink-subtle">MIR-1024</span>
          <StatusBadge status="in_progress" />
          <PriorityBadge priority="medium" />
        </div>
        <p className="mt-2.5 text-lg font-semibold tracking-tight text-ink">
          Ceiling fan not working
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-muted">
          <MapPin className="size-3.5" strokeWidth={1.75} />
          Block C, room 214
        </p>

        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-line px-4 py-3 text-sm">
          <div>
            <dt className="text-xs text-ink-subtle">Category</dt>
            <dd className="mt-0.5 font-medium text-ink">Electrical</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Assigned to</dt>
            <dd className="mt-0.5 font-medium text-ink">Electrical Maintenance</dd>
          </div>
        </dl>

        <ol className="relative mt-6 space-y-4">
          <span className="absolute top-3 bottom-3 left-[13px] w-px bg-line" />
          {EVENTS.map((event) => (
            <li key={event.title} className="relative flex gap-3">
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full ring-4 ring-surface",
                  event.tone === "brand"
                    ? "bg-brand-soft text-brand-strong"
                    : "bg-surface-muted text-ink-muted",
                )}
              >
                <event.icon className="size-3.5" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-sm font-medium text-ink">{event.title}</p>
                  <span className="shrink-0 font-mono text-[11px] text-ink-subtle">
                    {event.time}
                  </span>
                </div>
                <p className="text-xs text-ink-muted">{event.actor}</p>
                {event.note === undefined ? null : (
                  <p className="mt-1.5 rounded-md bg-surface-muted px-2.5 py-1.5 text-xs text-ink-muted">
                    {event.note}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
