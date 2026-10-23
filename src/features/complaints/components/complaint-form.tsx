"use client";

import { Send } from "lucide-react";
import { useActionState, useState } from "react";

import { buttonIconSlide } from "@/components/ui/button";
import { TextAreaField, TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { IDLE_FORM_STATE, type FormState } from "@/lib/forms/form-state";
import { cn } from "@/lib/utils/cn";

import { submitComplaintAction, type ComplaintField } from "../actions";
import { COMPLAINT_LIMITS } from "../schemas";

function CharacterCount({ length }: { readonly length: number }) {
  const { min, max } = COMPLAINT_LIMITS.description;
  return (
    <span
      aria-live="polite"
      className={cn(
        "text-xs tabular-nums transition-colors duration-200",
        length > max
          ? "font-semibold text-danger"
          : length >= min
            ? "text-success"
            : "text-ink-subtle",
      )}
    >
      {length} / {max}
    </span>
  );
}

interface FieldsProps {
  readonly values: Partial<Record<ComplaintField, string>>;
  readonly errors: Partial<Record<ComplaintField, string>>;
}

/** Uncontrolled inputs; re-mounted (via key) with the server's echoed values after an error. */
function ComplaintFields({ values, errors }: FieldsProps) {
  const [descriptionLength, setDescriptionLength] = useState(
    values.description?.trim().length ?? 0,
  );

  return (
    <>
      <TextField
        name="title"
        label="What is wrong?"
        hint="A short summary, for example “Ceiling fan not working”."
        required
        minLength={COMPLAINT_LIMITS.title.min}
        maxLength={COMPLAINT_LIMITS.title.max}
        defaultValue={values.title}
        error={errors.title}
        autoComplete="off"
      />

      <div className="grid gap-6 sm:grid-cols-[2fr_1fr]">
        <TextField
          name="building"
          label="Building"
          required
          maxLength={COMPLAINT_LIMITS.building.max}
          defaultValue={values.building}
          error={errors.building}
          autoComplete="off"
        />
        <TextField
          name="room"
          label="Room (optional)"
          maxLength={COMPLAINT_LIMITS.room.max}
          defaultValue={values.room}
          error={errors.room}
          autoComplete="off"
        />
      </div>

      <TextAreaField
        name="description"
        label="Describe the problem"
        hint="Where exactly it is, what you noticed, and since when. Please do not include personal or sensitive information."
        required
        rows={6}
        maxLength={COMPLAINT_LIMITS.description.max}
        defaultValue={values.description}
        error={errors.description}
        labelAside={<CharacterCount length={descriptionLength} />}
        onChange={(event) => {
          setDescriptionLength(event.currentTarget.value.trim().length);
        }}
      />
    </>
  );
}

/**
 * The idempotency key comes from the server render and never changes while this form is on
 * screen: repeated or retried submissions all carry it, so at most one ticket is created.
 */
export function ComplaintForm({ idempotencyKey }: { readonly idempotencyKey: string }) {
  const [state, formAction] = useActionState<FormState<ComplaintField>, FormData>(
    submitComplaintAction,
    IDLE_FORM_STATE,
  );
  const values = state.values ?? {};

  return (
    <form action={formAction} noValidate className="space-y-6">
      {state.message === undefined ? null : <Notice tone="error">{state.message}</Notice>}
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <ComplaintFields
        key={JSON.stringify(values)}
        values={values}
        errors={state.fieldErrors ?? {}}
      />

      <div className="flex flex-col-reverse items-stretch gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted">You can follow every update from your dashboard.</p>
        <SubmitButton pendingLabel="Submitting…">
          Submit report
          <Send aria-hidden="true" className={buttonIconSlide} />
        </SubmitButton>
      </div>
    </form>
  );
}
