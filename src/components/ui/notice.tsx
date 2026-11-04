import { CircleAlert, CircleCheck, Info, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export type NoticeTone = "info" | "success" | "error";

export const NOTICE_TONES: Readonly<
  Record<NoticeTone, { icon: LucideIcon; className: string; iconClassName: string }>
> = {
  info: {
    icon: Info,
    className: "border-line-strong bg-surface-muted",
    iconClassName: "text-brand",
  },
  success: {
    icon: CircleCheck,
    className: "border-success/25 bg-success-soft",
    iconClassName: "text-success",
  },
  error: {
    icon: CircleAlert,
    className: "border-danger/25 bg-danger-soft",
    iconClassName: "text-danger",
  },
};

interface NoticeProps {
  readonly tone: NoticeTone;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * Inline feedback that belongs next to what it describes (form errors, a fresh confirmation).
 * Errors interrupt screen readers (role=alert); others announce politely. One-off confirmations
 * after an action use <Toast> instead.
 */
export function Notice({ tone, children, className }: NoticeProps) {
  const { icon: Icon, className: toneClassName, iconClassName } = NOTICE_TONES[tone];

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        // Enters with the same short rise as a toast, so a new message is noticed, not missed.
        "animate-toast-in",
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm text-ink",
        toneClassName,
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", iconClassName)} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
