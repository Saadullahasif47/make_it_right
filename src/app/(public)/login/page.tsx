import { ArrowLeft, KeyRound } from "lucide-react";
import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Phase 0 holding page so public links never dead-end. Replaced by the Supabase email
 * sign-in form in Phase 1 (P1.05).
 */
export default function LoginPage() {
  return (
    <Container className="flex justify-center py-20 sm:py-28">
      <div className="w-full max-w-md animate-fade-up rounded-2xl border border-line bg-surface p-8 text-center shadow-lift">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand-strong">
          <KeyRound aria-hidden="true" className="size-5" />
        </span>
        <h1 className="mt-6 text-2xl font-extrabold tracking-tight text-ink">
          Sign-in is being set up
        </h1>
        <p className="mt-3 text-pretty text-ink-muted">
          Accounts for students, department staff and administrators open in the next release. You
          will be able to report and track issues from here.
        </p>
        <ButtonLink href="/" variant="secondary" className="mt-8">
          <ArrowLeft
            aria-hidden="true"
            className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5"
          />
          Back to home
        </ButtonLink>
      </div>
    </Container>
  );
}
