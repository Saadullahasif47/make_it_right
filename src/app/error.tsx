"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";

import { StatusScreen } from "@/components/layout/status-screen";
import { Button, ButtonLink } from "@/components/ui/button";

interface ErrorPageProps {
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
 * Route-level error boundary. Only the opaque digest is shown: it lets us find the
 * matching server log line without exposing internals to the user.
 */
export default function ErrorPage({ error, retry }: ErrorPageProps) {
  const digest = digestOf(error);

  return (
    <StatusScreen
      icon={TriangleAlert}
      code={digest === undefined ? undefined : `Reference ${digest}`}
      title="Something went wrong"
      description="We could not load this page. Your data is safe. Please try again in a moment."
      actions={
        <>
          <Button onClick={retry}>
            <RotateCcw
              aria-hidden="true"
              className="size-4 transition-transform duration-300 group-hover:-rotate-90"
            />
            Try again
          </Button>
          <ButtonLink href="/" variant="secondary">
            Back to home
          </ButtonLink>
        </>
      }
    />
  );
}
