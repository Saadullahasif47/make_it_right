"use client";

import { useActionState } from "react";

import { Notice } from "@/components/ui/notice";
import { PasswordField } from "@/components/ui/password-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { IDLE_FORM_STATE, type FormState } from "@/lib/forms/form-state";

import { updatePasswordAction, type NewPasswordField } from "../actions";
import { PASSWORD_MIN_LENGTH } from "../schemas";

export function NewPasswordForm() {
  const [state, formAction] = useActionState<FormState<NewPasswordField>, FormData>(
    updatePasswordAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} noValidate className="space-y-5">
      {state.message === undefined ? null : <Notice tone="error">{state.message}</Notice>}

      <PasswordField
        name="password"
        label="New password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        hint={`At least ${PASSWORD_MIN_LENGTH} characters, with letters and numbers.`}
        error={state.fieldErrors?.password}
      />

      <PasswordField
        name="confirmPassword"
        label="Confirm new password"
        autoComplete="new-password"
        required
        error={state.fieldErrors?.confirmPassword}
      />

      <SubmitButton pendingLabel="Saving…" className="w-full">
        Save new password
      </SubmitButton>
    </form>
  );
}
