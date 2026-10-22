import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";

import { AuthCard, TextLink } from "../_components/auth-card";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      description="Enter your account email and we will send you a link to choose a new password."
      footer={
        <>
          Remembered it? <TextLink href="/login">Back to sign in</TextLink>
        </>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
