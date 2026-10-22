import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Notice, type NoticeTone } from "@/components/ui/notice";
import { SignInForm } from "@/features/auth/components/sign-in-form";
import { toSafeInternalPath } from "@/features/auth/redirects";
import { ROLE_HOME_PATHS } from "@/features/auth/roles";
import { getSessionUser } from "@/features/auth/session";

import { AuthCard, FormSkeleton, TextLink } from "../_components/auth-card";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Readonly<Record<string, { tone: NoticeTone; text: string }>> = {
  "signed-out": { tone: "info", text: "You have been signed out." },
  "link-invalid": {
    tone: "error",
    text: "That link is invalid or has expired. Sign in, or request a new link.",
  },
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function LoginContent({
  searchParams,
}: {
  readonly searchParams: PageProps<"/login">["searchParams"];
}) {
  const user = await getSessionUser();
  if (user !== null) {
    redirect(ROLE_HOME_PATHS[user.role]);
  }

  const params = await searchParams;
  const notice = NOTICES[firstValue(params.notice) ?? ""];

  return (
    <div className="space-y-5">
      {notice === undefined ? null : <Notice tone={notice.tone}>{notice.text}</Notice>}
      <SignInForm next={toSafeInternalPath(firstValue(params.next))} />
    </div>
  );
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to report campus issues and follow their progress."
      footer={
        <>
          New to MakeItRight? <TextLink href="/signup">Create a student account</TextLink>
        </>
      }
    >
      <Suspense fallback={<FormSkeleton fields={2} />}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}
