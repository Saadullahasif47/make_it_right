import { cn } from "@/lib/utils/cn";

import { STATUS_LABELS, STATUS_TONES, type StatusTone, type TicketState } from "../statuses";

const TONE_CLASSES: Readonly<Record<StatusTone, { badge: string; dot: string }>> = {
  neutral: { badge: "bg-surface-muted text-ink-muted", dot: "bg-ink-subtle" },
  attention: { badge: "bg-accent-soft text-accent-ink", dot: "bg-accent" },
  active: { badge: "bg-brand-soft text-brand-strong", dot: "bg-brand" },
  done: { badge: "bg-success-soft text-success", dot: "bg-success" },
  warning: { badge: "bg-danger-soft text-danger", dot: "bg-danger" },
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
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
        tone.badge,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", tone.dot)} />
      {STATUS_LABELS[status]}
    </span>
  );
}
