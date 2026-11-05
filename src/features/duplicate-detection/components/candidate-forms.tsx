"use client";

import { Link2, Unlink } from "lucide-react";
import { useActionState } from "react";

import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { IDLE_FORM_STATE } from "@/lib/forms/form-state";

import { keepSeparateAction, reviewCandidateAction } from "../actions";

interface CandidateDecisionProps {
  readonly complaintId: string;
  readonly candidateId: string;
  /** The case version the admin is looking at; a newer one makes the link fail (409). */
  readonly expectedVersion: number;
  readonly caseReference: string;
}

/**
 * Accept or reject one candidate. Nothing is linked without this explicit choice; on success the
 * action redirects with a page notice.
 */
export function CandidateDecision({
  complaintId,
  candidateId,
  expectedVersion,
  caseReference,
}: CandidateDecisionProps) {
  const [state, formAction] = useActionState(reviewCandidateAction, IDLE_FORM_STATE);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="complaintId" value={complaintId} />
      <input type="hidden" name="candidateId" value={candidateId} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      {state.status === "error" && state.message !== undefined ? (
        <Notice tone="error">{state.message}</Notice>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <SubmitButton
          name="decision"
          value="accepted"
          size="sm"
          variant="secondary"
          pendingLabel="Linking…"
          aria-label={`Same problem: link to case ${caseReference}`}
        >
          <Link2 aria-hidden="true" className="size-4" />
          Same problem: link
        </SubmitButton>
        <SubmitButton
          name="decision"
          value="rejected"
          size="sm"
          variant="secondary"
          pendingLabel="Saving…"
          aria-label={`Different problem from case ${caseReference}`}
        >
          <Unlink aria-hidden="true" className="size-4" />
          Different problem
        </SubmitButton>
      </div>
    </form>
  );
}

export function KeepSeparate({ complaintId }: { readonly complaintId: string }) {
  const [state, formAction] = useActionState(keepSeparateAction, IDLE_FORM_STATE);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="complaintId" value={complaintId} />
      {state.status === "error" && state.message !== undefined ? (
        <Notice tone="error">{state.message}</Notice>
      ) : null}
      <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
        Keep as a separate case
      </SubmitButton>
    </form>
  );
}
