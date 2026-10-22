import { CircleAlert, CircleCheck, Info, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export type NoticeTone = "info" | "success" | "error";

const TONES: Readonly<Record<NoticeTone, { icon: LucideIcon; className: string }>> = {
  info: { icon: Info, className: "border-line-strong bg-surface-muted text-ink" },
  success: { icon: CircleCheck, className: "border-success/30 bg-success-soft text-ink" },
  error: { icon: CircleAlert, className: "border-danger/30 bg-danger-soft text-ink" },
};

interface NoticeProps {
  readonly tone: NoticeTone;
  readonly children: ReactNode;
  readonly className?: string;
}

/** Inline feedback. Errors interrupt screen readers (role=alert); others announce politely. */
export function Notice({ tone, children, className }: NoticeProps) {
  const { icon: Icon, className: toneClassName } = TONES[tone];

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex animate-fade-up items-start gap-3 rounded-xl border px-4 py-3 text-sm",
        toneClassName,
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "error" ? "text-danger" : tone === "success" ? "text-success" : "text-brand",
        )}
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
