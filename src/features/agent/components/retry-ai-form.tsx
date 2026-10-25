"use client";

import { RefreshCw } from "lucide-react";
import { useActionState } from "react";

import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { IDLE_FORM_STATE } from "@/lib/forms/form-state";

import { retryAiAction } from "../actions";

/** One bounded AI retry; the limits themselves are enforced in the database. */
export function RetryAiForm({
  ticketId,
  label,
}: {
  readonly ticketId: string;
  readonly label: string;
}) {
  const [state, formAction] = useActionState(retryAiAction, IDLE_FORM_STATE);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="ticketId" value={ticketId} />
      {state.message === undefined ? null : <Notice tone="error">{state.message}</Notice>}
      <SubmitButton
        pendingLabel="Asking the AI assistant…"
        size="md"
        variant="secondary"
        className="w-full"
      >
        <RefreshCw aria-hidden="true" className="size-4" />
        {label}
      </SubmitButton>
    </form>
  );
}
