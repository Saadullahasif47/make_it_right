"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";

import { Button, buttonIcon } from "@/components/ui/button";

interface AppErrorProps {
  /** Whatever was thrown; client-side throws are not guaranteed to be Error instances. */
  readonly error: unknown;
  readonly retry: () => void;
}

function digestOf(error: unknown): string | undefined {
  if (error instanceof Error && "digest" in error && typeof error.digest === "string") {
    return error.digest;
  }
  return undefined;
}

/**
 * Error boundary for signed-in pages. It renders inside the app shell, so the sidebar and
 * account menu stay and the person can retry or move on, instead of leaving the workspace.
 * Only the opaque digest is shown, which matches a server log line without exposing internals.
 */
export default function AppError({ error, retry }: AppErrorProps) {
  const digest = digestOf(error);

  return (
    <section
      aria-labelledby="app-error-title"
      className="flex flex-col items-center rounded-xl border border-line bg-surface px-6 py-14 text-center"
    >
      <span className="flex size-10 items-center justify-center rounded-lg bg-danger-soft text-danger">
        <TriangleAlert aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </span>
      <h1 id="app-error-title" className="mt-4 text-xl font-semibold tracking-tight text-ink">
        This page could not load
      </h1>
      <p className="mt-1.5 max-w-md text-sm text-pretty text-ink-muted">
        Nothing you saved was lost. Try again, or use the navigation to open another page.
      </p>
      {digest === undefined ? null : (
        <p className="mt-3 font-mono text-xs text-ink-subtle">Reference {digest}</p>
      )}
      <Button onClick={retry} className="mt-6">
        <RotateCcw aria-hidden="true" className={buttonIcon} />
        Try again
      </Button>
    </section>
  );
}
