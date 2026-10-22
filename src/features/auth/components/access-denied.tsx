import { ShieldX } from "lucide-react";

import { ButtonLink } from "@/components/ui/button";

import { ROLE_HOME_PATHS } from "../roles";
import type { SessionUser } from "../session";

/** Shown when a signed-in user opens another role's area. Reveals nothing about its content. */
export function AccessDenied({ user }: { readonly user: SessionUser }) {
  return (
    <section
      aria-labelledby="access-denied-title"
      className="mx-auto flex max-w-md animate-fade-up flex-col items-center py-16 text-center"
    >
      <span className="flex size-14 items-center justify-center rounded-2xl bg-danger-soft text-danger">
        <ShieldX aria-hidden="true" className="size-6" />
      </span>
      <p className="mt-6 font-mono text-sm font-semibold text-ink-subtle">403</p>
      <h1 id="access-denied-title" className="mt-2 text-2xl font-extrabold tracking-tight text-ink">
        You do not have access to this page
      </h1>
      <p className="mt-3 text-pretty text-ink-muted">
        This area belongs to a different role. If you think this is a mistake, contact your
        administrator.
      </p>
      <ButtonLink href={ROLE_HOME_PATHS[user.role]} className="mt-8">
        Go to your dashboard
      </ButtonLink>
    </section>
  );
}
