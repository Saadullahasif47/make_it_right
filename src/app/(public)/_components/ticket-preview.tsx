import { ArrowRight, Check, ShieldCheck, Sparkles } from "lucide-react";
import type { CSSProperties } from "react";

import { cn } from "@/lib/utils/cn";

interface PreviewStep {
  readonly label: string;
  readonly detail: string;
  readonly time: string;
  readonly state: "done" | "current" | "upcoming";
}

/** Illustrative data only; the real timeline is rendered from ticket_events in Phase 2. */
const STEPS: readonly PreviewStep[] = [
  { label: "Submitted", detail: "Saved to the cloud database", time: "09:12", state: "done" },
  {
    label: "Routed to Electrical",
    detail: "AI suggestion, checked against routing rules",
    time: "09:12",
    state: "done",
  },
  { label: "In progress", detail: "Technician acknowledged", time: "10:05", state: "current" },
  { label: "Resolved", detail: "You confirm the fix", time: "", state: "upcoming" },
];

function delay(ms: number): CSSProperties {
  return { animationDelay: `${ms}ms` };
}

export function TicketPreview() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none" aria-hidden="true">
      <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-linear-to-br from-brand-soft via-transparent to-accent-soft opacity-80 blur-2xl" />

      <div
        className="animate-fade-up rounded-2xl border border-line bg-surface p-5 shadow-lift sm:p-6"
        style={delay(250)}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs font-medium text-ink-subtle">MIR-2041 · Electrical</p>
            <p className="mt-1.5 font-semibold text-ink">Ceiling fan not working</p>
            <p className="text-sm text-ink-muted">Block C, Room 214</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand-strong">
            <span className="size-1.5 animate-pulse rounded-full bg-brand" />
            In progress
          </span>
        </div>

        <ol className="mt-6 space-y-4">
          {STEPS.map((step, index) => (
            <li
              key={step.label}
              className="flex animate-step-in gap-3"
              style={delay(500 + index * 220)}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2",
                  step.state === "done" && "border-brand bg-brand text-brand-fg",
                  step.state === "current" && "animate-pulse-ring border-brand bg-surface",
                  step.state === "upcoming" && "border-line-strong bg-surface",
                )}
              >
                {step.state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : null}
                {step.state === "current" ? (
                  <span className="size-2 rounded-full bg-brand" />
                ) : null}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p
                    className={cn(
                      "text-sm font-semibold",
                      step.state === "upcoming" ? "text-ink-subtle" : "text-ink",
                    )}
                  >
                    {step.label}
                  </p>
                  {step.time === "" ? null : (
                    <time className="font-mono text-xs text-ink-subtle">{step.time}</time>
                  )}
                </div>
                <p className="text-xs text-ink-muted">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div
        className="absolute -top-4 -right-2 hidden animate-fade-up sm:block lg:-right-6"
        style={delay(1400)}
      >
        <div className="flex animate-float items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink shadow-lift">
          <ShieldCheck className="size-4 text-success" />
          Saved before AI runs
        </div>
      </div>

      <div
        className="absolute -bottom-5 -left-2 hidden animate-fade-up sm:block lg:-left-8"
        style={delay(1650)}
      >
        <div
          className="flex animate-float items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink shadow-lift"
          style={{ animationDelay: "1.5s" }}
        >
          <Sparkles className="size-4 text-accent" />
          AI suggests
          <ArrowRight className="size-3 text-ink-subtle" />
          people decide
        </div>
      </div>
    </div>
  );
}
