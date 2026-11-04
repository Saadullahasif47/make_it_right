"use client";

import { RotateCcw } from "lucide-react";
import { useActionState } from "react";

import { SubmitButton } from "@/components/ui/submit-button";
import { IDLE_FORM_STATE } from "@/lib/forms/form-state";
import { cn } from "@/lib/utils/cn";

import { retryJobAction } from "../actions";

export function RetryJobForm({ jobId }: { readonly jobId: string }) {
  const [state, formAction] = useActionState(retryJobAction, IDLE_FORM_STATE);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1.5">
      <input type="hidden" name="jobId" value={jobId} />
      <SubmitButton pendingLabel="Queuing…" size="sm" variant="secondary">
        <RotateCcw aria-hidden="true" className="size-4" />
        Retry
      </SubmitButton>
      {state.message === undefined ? null : (
        <p
          role="status"
          className={cn("text-xs", state.status === "error" ? "text-danger" : "text-ink-muted")}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
