"use server";

import { redirect } from "next/navigation";

import { fieldErrorsFrom, readFields, type FormState } from "@/lib/forms/form-state";
import { getAppOrigin } from "@/lib/http/app-origin";
import { getLogger } from "@/lib/logging";
import { createRequestId } from "@/lib/logging/request-id";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { postSignInPath } from "./redirects";
import { ROLE_HOME_PATHS, isAppRole } from "./roles";
import {
  newPasswordSchema,
  passwordResetRequestSchema,
  signInSchema,
  signUpSchema,
} from "./schemas";
import { getSessionUser } from "./session";

const MESSAGES = {
  invalidCredentials: "Email or password is incorrect.",
  emailNotConfirmed: "Confirm your email address first. Check your inbox for the link.",
  rateLimited: "Too many attempts. Please wait a few minutes and try again.",
  unavailable: "We could not reach the sign-in service. Please try again shortly.",
  checkInboxSignUp:
    "If this address can be registered, we have sent a confirmation link. Check your inbox.",
  checkInboxReset: "If an account exists for this address, we have sent a password reset link.",
  sessionExpired: "Your reset link has expired. Request a new one.",
} as const;

const RATE_LIMIT_CODES = new Set(["over_request_rate_limit", "over_email_send_rate_limit"]);

function authFailure(action: string, code: string | undefined): void {
  // Only the stable error code is logged; emails and passwords never reach logs.
  getLogger().warn("auth.action_failed", {
    action,
    code: code ?? "unknown",
    requestId: createRequestId(),
  });
}

export type SignInField = "email" | "password" | "next";

export async function signInAction(
  _previous: FormState<SignInField>,
  formData: FormData,
): Promise<FormState<SignInField>> {
  const raw = readFields(formData, ["email", "password", "next"] as const);
  const values = { email: raw.email ?? "", next: raw.next ?? "" };
  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error !== null) {
    authFailure("sign_in", error.code);
    const message =
      error.code === "email_not_confirmed"
        ? MESSAGES.emailNotConfirmed
        : error.code !== undefined && RATE_LIMIT_CODES.has(error.code)
          ? MESSAGES.rateLimited
          : error.status !== undefined && error.status >= 500
            ? MESSAGES.unavailable
            : MESSAGES.invalidCredentials;
    return { status: "error", message, values };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profile === null || !isAppRole(profile.role)) {
    await supabase.auth.signOut({ scope: "local" });
    authFailure("sign_in", "profile_missing");
    return { status: "error", message: MESSAGES.unavailable, values };
  }

  redirect(postSignInPath(profile.role, parsed.data.next));
}

export type SignUpField = "displayName" | "email" | "password";

export async function signUpAction(
  _previous: FormState<SignUpField>,
  formData: FormData,
): Promise<FormState<SignUpField>> {
  const raw = readFields(formData, ["displayName", "email", "password"] as const);
  const values = { displayName: raw.displayName ?? "", email: raw.email ?? "" };
  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${await getAppOrigin()}/auth/confirm`,
      // Only the display name is accepted from the client; the database ignores anything else.
      data: { display_name: parsed.data.displayName },
    },
  });

  if (error !== null) {
    authFailure("sign_up", error.code);
    if (error.code === "weak_password") {
      return {
        status: "error",
        fieldErrors: { password: "Choose a stronger password." },
        values,
      };
    }
    if (error.code !== undefined && RATE_LIMIT_CODES.has(error.code)) {
      return { status: "error", message: MESSAGES.rateLimited, values };
    }
    if (error.code !== "user_already_exists") {
      return { status: "error", message: MESSAGES.unavailable, values };
    }
  }

  // Identical response whether or not the address was already registered (no enumeration).
  return { status: "success", message: MESSAGES.checkInboxSignUp };
}

export type ResetRequestField = "email";

export async function requestPasswordResetAction(
  _previous: FormState<ResetRequestField>,
  formData: FormData,
): Promise<FormState<ResetRequestField>> {
  const raw = readFields(formData, ["email"] as const);
  const parsed = passwordResetRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: fieldErrorsFrom(parsed.error),
      values: { email: raw.email ?? "" },
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await getAppOrigin()}/auth/confirm`,
  });

  if (error !== null) {
    authFailure("password_reset_request", error.code);
    if (error.code !== undefined && RATE_LIMIT_CODES.has(error.code)) {
      return {
        status: "error",
        message: MESSAGES.rateLimited,
        values: { email: parsed.data.email },
      };
    }
  }

  return { status: "success", message: MESSAGES.checkInboxReset };
}

export type NewPasswordField = "password" | "confirmPassword";

export async function updatePasswordAction(
  _previous: FormState<NewPasswordField>,
  formData: FormData,
): Promise<FormState<NewPasswordField>> {
  const user = await getSessionUser();
  if (user === null) {
    return { status: "error", message: MESSAGES.sessionExpired };
  }

  const parsed = newPasswordSchema.safeParse(
    readFields(formData, ["password", "confirmPassword"] as const),
  );
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error !== null) {
    authFailure("password_update", error.code);
    if (error.code === "same_password") {
      return {
        status: "error",
        fieldErrors: { password: "Choose a password you have not used before." },
      };
    }
    if (error.code === "weak_password") {
      return { status: "error", fieldErrors: { password: "Choose a stronger password." } };
    }
    return { status: "error", message: MESSAGES.unavailable };
  }

  redirect(`${ROLE_HOME_PATHS[user.role]}?notice=password-updated`);
}

export async function signOutAction(): Promise<never> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error !== null) {
    authFailure("sign_out", error.code);
  }
  redirect("/login?notice=signed-out");
}
