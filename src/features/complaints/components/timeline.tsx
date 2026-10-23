import {
  CircleCheck,
  CirclePlus,
  Eye,
  Lock,
  MessageSquareText,
  RotateCcw,
  Route,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { LocalTime } from "@/components/ui/local-time";
import type { AppRole } from "@/features/auth/roles";
import { cn } from "@/lib/utils/cn";

import { CATEGORY_LABELS, isComplaintCategory } from "../categories";
import type { TimelineEvent } from "../repository";
import { PRIORITY_LABELS, STATUS_LABELS } from "../statuses";

/** People are shown by role, never by name: students cannot see staff identities. */
const ROLE_LABELS: Readonly<Record<AppRole, string>> = {
  student: "Reporter",
  department: "Department staff",
  admin: "Administrator",
};

/** Automated actors are always named, so a reader never mistakes them for a person. */
const AUTOMATED_ACTORS: Readonly<Record<Exclude<TimelineEvent["actorKind"], "user">, string>> = {
  agent: "AI assistant",
  rule: "Rule-based routing",
  system: "MakeItRight",
};

function actorLabel(event: TimelineEvent): string | null {
  if (event.actorKind !== "user") {
    return AUTOMATED_ACTORS[event.actorKind];
  }
  return event.actorRole === null ? null : ROLE_LABELS[event.actorRole];
}

interface Presentation {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly tone: "brand" | "success" | "warning" | "neutral";
}

function present(event: TimelineEvent): Presentation {
  switch (event.type) {
    case "created":
      return { icon: CirclePlus, title: "Report submitted", tone: "brand" };
    case "assigned":
      return {
        icon: Route,
        title: event.departmentName === null ? "Assigned" : `Assigned to ${event.departmentName}`,
        tone: "brand",
      };
    case "acknowledged":
      return { icon: Eye, title: "Acknowledged by the department", tone: "neutral" };
    case "note_added":
      return { icon: MessageSquareText, title: "Work note", tone: "neutral" };
    case "status_changed":
      switch (event.newStatus) {
        case "in_progress":
          return { icon: Wrench, title: "Work started", tone: "brand" };
        case "resolved":
          return { icon: CircleCheck, title: "Marked resolved", tone: "success" };
        case "closed":
          return { icon: Lock, title: "Closed: fix confirmed", tone: "success" };
        case "reopened":
          return { icon: RotateCcw, title: "Reopened: still a problem", tone: "warning" };
        case null:
        case "submitted":
        case "triaging":
        case "needs_review":
        case "assigned":
          return {
            icon: Route,
            title:
              event.newStatus === null
                ? "Status changed"
                : `Moved to ${STATUS_LABELS[event.newStatus]}`,
            tone: "neutral",
          };
      }
  }
}

const TONES: Readonly<Record<Presentation["tone"], string>> = {
  brand: "bg-brand-soft text-brand-strong",
  success: "bg-success-soft text-success",
  warning: "bg-danger-soft text-danger",
  neutral: "bg-surface-muted text-ink-muted",
};

function classification(event: TimelineEvent): string | null {
  if (event.type !== "assigned") {
    return null;
  }
  const parts = [
    event.category !== null && isComplaintCategory(event.category)
      ? CATEGORY_LABELS[event.category]
      : null,
    event.priority === null ? null : `${PRIORITY_LABELS[event.priority]} priority`,
  ].filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join(" · ");
}

/** Append-only history of a ticket, oldest first (plan §6, BR-04). */
export function Timeline({ events }: { readonly events: readonly TimelineEvent[] }) {
  return (
    <ol aria-label="Ticket history" className="relative space-y-6">
      {events.map((event, index) => {
        const { icon: Icon, title, tone } = present(event);
        const actor = actorLabel(event);
        const details = classification(event);
        const isLast = index === events.length - 1;
        return (
          <li
            key={event.id}
            className="relative flex animate-step-in gap-4"
            style={{ animationDelay: `${index * 60}ms` }}
          >
            {isLast ? null : (
              <span
                aria-hidden="true"
                className="absolute top-9 bottom-[-1.5rem] left-[17px] w-px bg-line"
              />
            )}
            <span
              className={cn(
                "relative flex size-9 shrink-0 items-center justify-center rounded-full ring-4 ring-surface",
                TONES[tone],
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0 pt-1">
              <p className="font-semibold text-ink">{title}</p>
              <p className="mt-0.5 text-sm text-ink-muted">
                {actor === null ? null : `${actor} · `}
                <LocalTime value={event.createdAt} />
              </p>
              {details === null ? null : <p className="mt-1 text-sm text-ink-muted">{details}</p>}
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
