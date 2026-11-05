"use client";

import { Check, MessageSquareWarning, PencilLine } from "lucide-react";
import { useActionState, useId } from "react";

import { inputClassName } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { COMPLAINT_CATEGORIES, CATEGORY_LABELS } from "@/features/complaints/categories";
import { IDLE_FORM_STATE } from "@/lib/forms/form-state";
import { cn } from "@/lib/utils/cn";

import { reviewAnalysisAction, type ReviewField } from "../actions";

interface ReviewFormProps {
  readonly complaintId: string;
  readonly analysisId: string;
  /** Admins may record a corrected category; reporters confirm or dispute. */
  readonly canCorrect: boolean;
}

/** "Does this look right?": a person's response, recorded beside the AI's analysis. */
export function ReviewForm({ complaintId, analysisId, canCorrect }: ReviewFormProps) {
  const [state, formAction] = useActionState(reviewAnalysisAction, IDLE_FORM_STATE);
  const id = useId();
  const errors: Partial<Record<ReviewField, string>> = state.fieldErrors ?? {};

  if (state.status === "success") {
    return <Notice tone="success">{state.message}</Notice>;
  }

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="complaintId" value={complaintId} />
      <input type="hidden" name="analysisId" value={analysisId} />
      {state.status === "error" && state.message !== undefined ? (
        <Notice tone="error">{state.message}</Notice>
      ) : null}

      {canCorrect ? (
        <div className="space-y-1.5">
          <label htmlFor={`${id}-category`} className="text-sm font-medium text-ink">
            Correct category (optional)
          </label>
          <select
            id={`${id}-category`}
            name="correctedCategory"
            defaultValue=""
            aria-invalid={errors.correctedCategory === undefined ? undefined : true}
            aria-describedby={
              errors.correctedCategory === undefined ? undefined : `${id}-category-error`
            }
            className={cn(inputClassName, "h-10")}
          >
            <option value="">Keep the AI&apos;s suggestion</option>
            {COMPLAINT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
          {errors.correctedCategory === undefined ? null : (
            <p id={`${id}-category-error`} className="text-sm text-danger">
              {errors.correctedCategory}
            </p>
          )}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor={`${id}-note`} className="text-sm font-medium text-ink">
          Note {canCorrect ? "(optional)" : "(needed if something is wrong)"}
        </label>
        <textarea
          id={`${id}-note`}
          name="note"
          rows={2}
          maxLength={500}
          aria-invalid={errors.note === undefined ? undefined : true}
          aria-describedby={errors.note === undefined ? undefined : `${id}-note-error`}
          className={cn(inputClassName, "min-h-16 py-2")}
        />
        {errors.note === undefined ? null : (
          <p id={`${id}-note-error`} className="text-sm text-danger">
            {errors.note}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <SubmitButton
          name="decision"
          value="confirmed"
          size="sm"
          variant="secondary"
          pendingLabel="Saving…"
        >
          <Check aria-hidden="true" className="size-4" />
          Looks right
        </SubmitButton>
        <SubmitButton
          name="decision"
          value="disputed"
          size="sm"
          variant="secondary"
          pendingLabel="Saving…"
        >
          <MessageSquareWarning aria-hidden="true" className="size-4" />
          Something is wrong
        </SubmitButton>
        {canCorrect ? (
          <SubmitButton
            name="decision"
            value="corrected"
            size="sm"
            variant="secondary"
            pendingLabel="Saving…"
          >
            <PencilLine aria-hidden="true" className="size-4" />
            Save correction
          </SubmitButton>
        ) : null}
      </div>
    </form>
  );
}
