"use client";

import { Check, RefreshCw } from "lucide-react";
import { useActionState } from "react";

import { inputClassName } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { IDLE_FORM_STATE } from "@/lib/forms/form-state";

import { acknowledgeAlertAction, refreshAlertsAction, setSlaAction } from "../actions";

export function AcknowledgeAlert({ alertId }: { readonly alertId: string }) {
  const [state, action] = useActionState(acknowledgeAlertAction, IDLE_FORM_STATE);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="alertId" value={alertId} />
      <label className="grid min-w-48 flex-1 gap-1 text-xs font-medium text-ink-muted">
        Note (optional)
        <input name="note" maxLength={500} className={inputClassName} />
      </label>
      <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
        <Check aria-hidden="true" className="size-4" />
        Acknowledge
      </SubmitButton>
      {state.status === "error" && state.message !== undefined ? (
        <Notice tone="error" className="basis-full">
          {state.message}
        </Notice>
      ) : null}
    </form>
  );
}

export function RefreshAlerts() {
  const [state, action] = useActionState(refreshAlertsAction, IDLE_FORM_STATE);
  return (
    <form action={action} className="space-y-2">
      <SubmitButton size="sm" variant="secondary" pendingLabel="Refreshing…">
        <RefreshCw aria-hidden="true" className="size-4" />
        Refresh now
      </SubmitButton>
      {state.status === "error" && state.message !== undefined ? (
        <Notice tone="error">{state.message}</Notice>
      ) : null}
    </form>
  );
}

export function SlaForm({
  category,
  label,
  targetDays,
}: {
  readonly category: string;
  readonly label: string;
  readonly targetDays: number;
}) {
  const [state, action] = useActionState(setSlaAction, IDLE_FORM_STATE);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="category" value={category} />
      <label className="grid gap-1 text-sm font-medium text-ink">
        {label}
        <span className="flex items-center gap-2">
          <input
            name="targetDays"
            type="number"
            min={1}
            max={90}
            required
            defaultValue={targetDays}
            className={`${inputClassName} w-24`}
          />
          <span className="text-sm font-normal text-ink-muted">days</span>
        </span>
      </label>
      <SubmitButton
        size="sm"
        variant="secondary"
        pendingLabel="Saving…"
        aria-label={`Save ${label} target`}
      >
        Save
      </SubmitButton>
      {state.status === "error" && state.message !== undefined ? (
        <Notice tone="error" className="basis-full">
          {state.message}
        </Notice>
      ) : null}
    </form>
  );
}
