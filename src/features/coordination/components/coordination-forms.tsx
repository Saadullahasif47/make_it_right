"use client";

import { Check, Sparkles, X } from "lucide-react";
import { useActionState } from "react";

import { TextAreaField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { IDLE_FORM_STATE } from "@/lib/forms/form-state";

import { decideProposalAction, requestCoordinationAction } from "../actions";

export function RequestCoordination({
  complaintId,
  caseId,
  again,
}: {
  readonly complaintId: string;
  readonly caseId: string;
  /** A run already exists: the button asks for a fresh look. */
  readonly again: boolean;
}) {
  const [state, formAction] = useActionState(requestCoordinationAction, IDLE_FORM_STATE);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="complaintId" value={complaintId} />
      <input type="hidden" name="caseId" value={caseId} />
      {state.status === "error" && state.message !== undefined ? (
        <Notice tone="error">{state.message}</Notice>
      ) : null}
      <SubmitButton size="sm" variant="secondary" pendingLabel="Asking…">
        <Sparkles aria-hidden="true" className="size-4" />
        {again ? "Ask the coordinator again" : "Ask the coordinator"}
      </SubmitButton>
    </form>
  );
}

/**
 * Approve or reject a pending proposal. The case version travels with the form, so a case that
 * changed since the page loaded is refused instead of being overwritten.
 */
export function ProposalDecision({
  complaintId,
  proposalId,
  expectedVersion,
}: {
  readonly complaintId: string;
  readonly proposalId: string;
  readonly expectedVersion: number;
}) {
  const [state, formAction] = useActionState(decideProposalAction, IDLE_FORM_STATE);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="complaintId" value={complaintId} />
      <input type="hidden" name="proposalId" value={proposalId} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <TextAreaField
        name="note"
        id={`proposal-note-${proposalId}`}
        label="Note (optional)"
        hint="Kept with your decision for the audit trail."
        maxLength={500}
        rows={2}
        className="min-h-16"
      />
      {state.status === "error" && state.message !== undefined ? (
        <Notice tone="error">{state.message}</Notice>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="decision" value="approve" size="sm" pendingLabel="Approving…">
          <Check aria-hidden="true" className="size-4" />
          Approve work order
        </SubmitButton>
        <SubmitButton
          name="decision"
          value="reject"
          size="sm"
          variant="secondary"
          pendingLabel="Saving…"
        >
          <X aria-hidden="true" className="size-4" />
          Reject
        </SubmitButton>
      </div>
    </form>
  );
}
