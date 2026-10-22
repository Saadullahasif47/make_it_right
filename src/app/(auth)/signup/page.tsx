import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SignUpForm } from "@/features/auth/components/sign-up-form";
import { ROLE_HOME_PATHS } from "@/features/auth/roles";
import { getSessionUser } from "@/features/auth/session";

import { AuthCard, FormSkeleton, TextLink } from "../_components/auth-card";

export const metadata: Metadata = { title: "Create account" };

async function SignUpContent() {
  const user = await getSessionUser();
  if (user !== null) {
    redirect(ROLE_HOME_PATHS[user.role]);
  }
  return <SignUpForm />;
}

export default function SignUpPage() {
  return (
    <AuthCard
      title="Create a student account"
      description="Department and admin accounts are set up by the university. Use fictional details in this prototype."
      footer={
        <>
          Already have an account? <TextLink href="/login">Sign in</TextLink>
        </>
      }
    >
      <Suspense fallback={<FormSkeleton fields={3} />}>
        <SignUpContent />
      </Suspense>
    </AuthCard>
  );
}
