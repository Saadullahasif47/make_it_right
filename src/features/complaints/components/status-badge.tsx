import { cn } from "@/lib/utils/cn";

import { STATUS_LABELS, STATUS_TONES, type StatusTone, type TicketState } from "../statuses";

const TONE_CLASSES: Readonly<Record<StatusTone, { badge: string; dot: string }>> = {
  neutral: { badge: "bg-surface-muted text-ink-muted", dot: "bg-ink-subtle" },
  routing: { badge: "bg-brand-soft text-brand-strong", dot: "bg-brand/60" },
  attention: { badge: "bg-accent-soft text-accent-ink", dot: "bg-accent" },
  queued: { badge: "bg-info-soft text-info-ink", dot: "bg-info" },
  active: { badge: "bg-brand-soft text-brand-strong", dot: "bg-brand" },
  done: { badge: "bg-success-soft text-success", dot: "bg-success" },
  warning: { badge: "bg-danger-soft text-danger", dot: "bg-danger" },
  closed: { badge: "bg-surface-muted text-ink", dot: "bg-ink" },
};

export function StatusBadge({
  status,
  className,
}: {
  readonly status: TicketState;
  readonly className?: string;
}) {
  const tone = TONE_CLASSES[STATUS_TONES[status]];
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap transition-colors duration-(--motion-base)",
        tone.badge,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", tone.dot)} />
      {STATUS_LABELS[status]}
    </span>
  );
}
