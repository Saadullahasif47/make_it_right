"use client";

import { MailCheck } from "lucide-react";
import { useActionState } from "react";

import { ButtonLink } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { PasswordField } from "@/components/ui/password-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { IDLE_FORM_STATE, type FormState } from "@/lib/forms/form-state";

import { signUpAction, type SignUpField } from "../actions";
import { PASSWORD_MIN_LENGTH } from "../schemas";

export function SignUpForm() {
  const [state, formAction] = useActionState<FormState<SignUpField>, FormData>(
    signUpAction,
    IDLE_FORM_STATE,
  );

  if (state.status === "success") {
    return (
      <div className="animate-fade-up space-y-6 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-success-soft text-success">
          <MailCheck aria-hidden="true" className="size-5" />
        </span>
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
        name="displayName"
        label="Full name"
        autoComplete="name"
        required
        maxLength={80}
        defaultValue={state.values?.displayName}
        error={state.fieldErrors?.displayName}
        key={`name-${state.values?.displayName ?? ""}`}
      />

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

      <PasswordField
        name="password"
        label="Password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        hint={`At least ${PASSWORD_MIN_LENGTH} characters, with letters and numbers.`}
        error={state.fieldErrors?.password}
      />

      <SubmitButton pendingLabel="Creating account…" className="w-full">
        Create student account
      </SubmitButton>
    </form>
  );
}
