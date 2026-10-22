"use client";

import { useActionState } from "react";

import { ButtonLink } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { IDLE_FORM_STATE, type FormState } from "@/lib/forms/form-state";

import { requestPasswordResetAction, type ResetRequestField } from "../actions";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState<FormState<ResetRequestField>, FormData>(
    requestPasswordResetAction,
    IDLE_FORM_STATE,
  );

  if (state.status === "success") {
    return (
      <div className="animate-fade-up space-y-6">
        <Notice tone="success">{state.message}</Notice>
        <ButtonLink href="/login" variant="secondary" className="w-full">
          Back to sign in
        </ButtonLink>
      </div>
    );
  }

  return (
    <form action={formAction} noValidate className="space-y-5">
      {state.message === undefined ? null : <Notice tone="error">{state.message}</Notice>}

      <TextField
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
        key={`email-${state.values?.email ?? ""}`}
      />

      <SubmitButton pendingLabel="Sending link…" className="w-full">
        Send reset link
      </SubmitButton>
    </form>
  );
}
