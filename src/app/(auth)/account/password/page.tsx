import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { NewPasswordForm } from "@/features/auth/components/new-password-form";
import { loginPathFor } from "@/features/auth/redirects";
import { getSessionUser } from "@/features/auth/session";

import { AuthCard, FormSkeleton } from "../../_components/auth-card";

export const metadata: Metadata = { title: "Choose a new password" };

async function NewPasswordContent() {
  // Reached from a password-reset link (recovery session) or by a signed-in user.
  const user = await getSessionUser();
  if (user === null) {
    redirect(loginPathFor("/account/password"));
  }
  return <NewPasswordForm />;
}

export default function NewPasswordPage() {
  return (
    <AuthCard
      title="Choose a new password"
      description="Pick a password you have not used here before. You will stay signed in."
    >
      <Suspense fallback={<FormSkeleton fields={2} />}>
        <NewPasswordContent />
      </Suspense>
    </AuthCard>
  );
}
