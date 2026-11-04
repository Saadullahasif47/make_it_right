"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

import { NOTICE_TONES, type NoticeTone } from "./notice";

const EXIT_MS = 150;

interface ToastProps {
  readonly tone?: NoticeTone;
  readonly children: ReactNode;
  /** Milliseconds before it hides itself; hovering or focusing it pauses the countdown. */
  readonly duration?: number;
}

/**
 * A one-off confirmation after an action ("Note added"). It floats above the page, announces
 * itself politely, can be dismissed, and never hides anything the page does not also show.
 */
export function Toast({ tone = "success", children, duration = 6000 }: ToastProps) {
  const [phase, setPhase] = useState<"shown" | "leaving" | "gone">("shown");
  const [paused, setPaused] = useState(false);
  const remaining = useRef(duration);

  const dismiss = useCallback(() => {
    setPhase("leaving");
  }, []);

  useEffect(() => {
    if (phase !== "leaving") {
      return;
    }
    const timer = window.setTimeout(() => {
      setPhase("gone");
    }, EXIT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "shown" || paused) {
      return;
    }
    const started = Date.now();
    const timer = window.setTimeout(dismiss, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(1000, remaining.current - (Date.now() - started));
    };
  }, [phase, paused, dismiss]);

  if (phase === "gone") {
    return null;
  }

  const { icon: Icon, iconClassName } = NOTICE_TONES[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      onMouseEnter={() => {
        setPaused(true);
      }}
      onMouseLeave={() => {
        setPaused(false);
      }}
      onFocus={() => {
        setPaused(true);
      }}
      onBlur={() => {
        setPaused(false);
      }}
      className={cn(
        "fixed inset-x-4 bottom-4 z-50 flex animate-toast-in items-start gap-3 rounded-lg border border-line bg-surface py-3 pr-2 pl-4 text-sm text-ink shadow-lift",
        "transition-[opacity,translate] duration-(--motion-fast) ease-(--ease-exit) sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96",
        phase === "leaving" && "translate-y-2 opacity-0",
      )}
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", iconClassName)} />
      <div className="min-w-0 flex-1 py-px">{children}</div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="-my-1 flex size-7 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
