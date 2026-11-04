"use client";

import {
  CircleCheck,
  CirclePlus,
  Lock,
  MapPin,
  Pause,
  Play,
  RotateCcw,
  Route,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { StatusBadge } from "@/features/complaints/components/status-badge";
import { PriorityBadge } from "@/features/complaints/components/ticket-parts";
import type { TicketPriority, TicketState } from "@/features/complaints/statuses";
import { cn } from "@/lib/utils/cn";

interface DemoEvent {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly actor: string;
  readonly time: string;
  readonly note?: string;
  readonly tone: "brand" | "neutral" | "success";
}

/* One example ticket, told with the same titles, actors and order as the real timeline. */
const EVENTS: readonly DemoEvent[] = [
  { icon: CirclePlus, title: "Report submitted", actor: "Reporter", time: "09:12", tone: "brand" },
  {
    icon: Route,
    title: "Assigned to Electrical Maintenance",
    actor: "AI assistant",
    time: "09:12",
    note: "A ceiling fan that will not start is an electrical fault in a classroom.",
    tone: "brand",
  },
  {
    icon: Wrench,
    title: "Work started",
    actor: "Department staff",
    time: "10:05",
    tone: "neutral",
  },
  {
    icon: CircleCheck,
    title: "Marked resolved",
    actor: "Department staff",
    time: "11:30",
    note: "Capacitor replaced; fan tested for 20 minutes.",
    tone: "success",
  },
  { icon: Lock, title: "Closed: fix confirmed", actor: "Reporter", time: "12:02", tone: "success" },
];

interface Step {
  /** Short label on the step control. */
  readonly label: string;
  readonly status: TicketState;
  readonly priority: TicketPriority;
  readonly assigned: boolean;
  /** How many history entries are visible at this step. */
  readonly events: number;
}

const STEPS: readonly Step[] = [
  { label: "Reported", status: "submitted", priority: "unassessed", assigned: false, events: 1 },
  { label: "Assigned", status: "assigned", priority: "medium", assigned: true, events: 2 },
  { label: "In progress", status: "in_progress", priority: "medium", assigned: true, events: 3 },
  { label: "Resolved", status: "resolved", priority: "medium", assigned: true, events: 4 },
  { label: "Closed", status: "closed", priority: "medium", assigned: true, events: 5 },
];
const LAST = STEPS.length - 1;
const STEP_MS = 1800;

const TONES: Readonly<Record<DemoEvent["tone"], string>> = {
  brand: "bg-brand-soft text-brand-strong",
  neutral: "bg-surface-muted text-ink-muted",
  success: "bg-success-soft text-success",
};

const control =
  "inline-flex h-8 items-center justify-center rounded-md text-xs font-medium transition-colors";

/**
 * The homepage demonstration: one example ticket moving from report to closed, built from the
 * app's own badges and timeline wording. It plays once when it comes into view, then stops; it
 * pauses while hovered or focused, and every step can be chosen directly. With reduced motion it
 * never plays by itself and starts on the finished ticket. Space for every history entry is
 * reserved, so the hero never changes height while it plays.
 */
export function TicketPreview() {
  // The server renders the finished ticket: complete without JavaScript, and in screenshots.
  const [step, setStep] = useState(LAST);
  const [playing, setPlaying] = useState(false);
  const [held, setHeld] = useState(false);
  const root = useRef<HTMLElement>(null);
  const played = useRef(false);

  const play = useCallback(() => {
    setStep(0);
    setPlaying(true);
  }, []);

  // Play once, the first time the demonstration is actually seen.
  useEffect(() => {
    const element = root.current;
    // Without the APIs (old browsers, test DOMs) or with reduced motion, it stays on the result.
    if (
      element === null ||
      typeof IntersectionObserver === "undefined" ||
      typeof window.matchMedia !== "function" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting === true && !played.current) {
          played.current = true;
          play();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [play]);

  // Playback ends on its own at the last step; nothing needs resetting.
  const running = playing && step < LAST;

  useEffect(() => {
    if (!running || held) return;
    const timer = window.setTimeout(() => {
      setStep((current) => Math.min(current + 1, LAST));
    }, STEP_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [running, held, step]);

  const current = STEPS[step] ?? STEPS[LAST];
  const shownEvents = current?.events ?? EVENTS.length;
  const toggleLabel = running ? "Pause" : step >= LAST ? "Replay" : "Play";
  const ToggleIcon = running ? Pause : step >= LAST ? RotateCcw : Play;

  return (
    <section
      ref={root}
      aria-label="Example: one ticket from report to closed"
      onMouseEnter={() => {
        setHeld(true);
      }}
      onMouseLeave={() => {
        setHeld(false);
      }}
      onFocus={() => {
        setHeld(true);
      }}
      onBlur={() => {
        setHeld(false);
      }}
      className="overflow-hidden rounded-xl border border-line bg-surface shadow-lift"
    >
      <div className="flex items-center gap-1.5 border-b border-line bg-surface-muted px-4 py-2.5">
        <span aria-hidden="true" className="size-2.5 rounded-full bg-line-strong" />
        <span aria-hidden="true" className="size-2.5 rounded-full bg-line-strong" />
        <span aria-hidden="true" className="size-2.5 rounded-full bg-line-strong" />
        <span className="ml-3 truncate font-mono text-[11px] text-ink-subtle">
          Example ticket · MakeItRight
        </span>
      </div>

      {/* The lifecycle as real controls: each step can be shown directly. */}
      <div className="border-b border-line px-5 pt-4 pb-3 sm:px-6">
        <div className="flex items-center gap-3">
          <ol className="grid flex-1 grid-cols-5 gap-1.5">
            {STEPS.map((item, index) => (
              <li key={item.label}>
                <button
                  type="button"
                  onClick={() => {
                    setPlaying(false);
                    setStep(index);
                  }}
                  aria-label={`Show step ${index + 1}: ${item.label}`}
                  aria-current={index === step ? "step" : undefined}
                  className="group block w-full py-1.5"
                >
                  <span className="block h-1 overflow-hidden rounded-full bg-line">
                    <span
                      className={cn(
                        "block h-full origin-left rounded-full bg-brand transition-[scale] duration-(--motion-slow)",
                        index <= step ? "scale-x-100" : "scale-x-0",
                      )}
                    />
                  </span>
                  <span
                    className={cn(
                      "mt-1.5 block truncate text-left text-[11px] transition-colors",
                      index === step
                        ? "font-medium text-ink"
                        : "text-ink-subtle group-hover:text-ink",
                    )}
                  >
                    {item.label}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() => {
              if (running) setPlaying(false);
              else if (step >= LAST) play();
              else setPlaying(true);
            }}
            className={cn(
              control,
              "w-8 shrink-0 text-ink-muted hover:bg-surface-muted hover:text-ink",
            )}
            aria-label={`${toggleLabel} the example`}
            title={`${toggleLabel} the example`}
          >
            <ToggleIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />
          </button>
        </div>
        <p aria-live="polite" className="sr-only">
          Step {step + 1} of {STEPS.length}: {current?.label}. {EVENTS[shownEvents - 1]?.title}.
        </p>
      </div>

      {/* The ticket itself repeats what the controls announce, so it is hidden from screen readers. */}
      <div aria-hidden="true" className="p-5 select-none sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-medium text-ink-subtle">MIR-1024</span>
          <StatusBadge status={current?.status ?? "closed"} />
          <PriorityBadge priority={current?.priority ?? "medium"} />
        </div>
        <p className="mt-2.5 text-lg font-semibold tracking-tight text-ink">
          Ceiling fan not working
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-muted">
          <MapPin className="size-3.5" strokeWidth={1.75} />
          Block C, room 214
        </p>

        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-line px-4 py-3 text-sm [@media(max-height:760px)]:hidden">
          <div>
            <dt className="text-xs text-ink-subtle">Category</dt>
            <dd className="mt-0.5 font-medium text-ink">
              {current?.assigned === true ? "Electrical" : "Awaiting classification"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Assigned to</dt>
            <dd className="mt-0.5 font-medium text-ink">
              {current?.assigned === true ? "Electrical Maintenance" : "Not yet assigned"}
            </dd>
          </div>
        </dl>

        <ol className="mt-6 space-y-4">
          {EVENTS.map((event, index) => {
            const shown = index < shownEvents;
            const linked = index < shownEvents - 1;
            return (
              <li
                key={event.title}
                className={cn(
                  "relative flex gap-3 transition-[opacity,translate] duration-(--motion-base)",
                  shown ? "translate-y-0 opacity-100" : "invisible translate-y-1 opacity-0",
                )}
              >
                <span
                  className={cn(
                    "absolute top-8 bottom-[-1rem] left-[13px] w-px bg-line transition-opacity duration-(--motion-base)",
                    linked ? "opacity-100" : "opacity-0",
                  )}
                />
                <span
                  className={cn(
                    "relative flex size-7 shrink-0 items-center justify-center rounded-full ring-4 ring-surface transition-colors",
                    TONES[event.tone],
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
                    <p className="mt-1.5 rounded-md bg-surface-muted px-2.5 py-1.5 text-xs text-ink-muted [@media(max-height:820px)]:hidden">
                      {event.note}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
