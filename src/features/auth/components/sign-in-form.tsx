"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import { buttonIconSlide } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { PasswordField } from "@/components/ui/password-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { IDLE_FORM_STATE, type FormState } from "@/lib/forms/form-state";

import { signInAction, type SignInField } from "../actions";

export function SignInForm({ next }: { readonly next: string | undefined }) {
  const [state, formAction] = useActionState<FormState<SignInField>, FormData>(
    signInAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} noValidate className="space-y-5">
      {state.message === undefined ? null : <Notice tone="error">{state.message}</Notice>}

      <input type="hidden" name="next" value={state.values?.next ?? next ?? ""} />

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
        autoComplete="current-password"
        required
        error={state.fieldErrors?.password}
        labelAside={
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-brand underline-offset-4 hover:underline"
          >
            Forgot password?
          </Link>
        }
      />

      <SubmitButton pendingLabel="Signing in…" className="w-full">
        Sign in
        <ArrowRight aria-hidden="true" className={buttonIconSlide} />
      </SubmitButton>
    </form>
  );
}
