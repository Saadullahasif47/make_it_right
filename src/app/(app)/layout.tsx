import type { ReactNode } from "react";
import { Suspense } from "react";

import { Logo } from "@/components/brand/logo";
import { Container } from "@/components/ui/container";
import { AccountMenu } from "@/features/auth/components/account-menu";
import { NavLinks } from "@/features/auth/components/nav-links";
import { ROLE_NAVIGATION } from "@/features/auth/navigation";
import { getSessionUser } from "@/features/auth/session";

/** Role-aware chrome. Rendering it is cosmetic; each page authorises itself on the server. */
async function SessionChrome() {
  const user = await getSessionUser();
  if (user === null) {
    return null;
  }

  return (
    <>
      <div className="flex items-center">
        <AccountMenu user={user} />
      </div>
      <nav aria-label="Workspace" className="col-span-2 -mb-px">
        <NavLinks items={ROLE_NAVIGATION[user.role]} />
      </nav>
    </>
  );
}

function ChromeSkeleton() {
  return <div aria-hidden="true" className="h-9 w-40 animate-pulse rounded-lg bg-surface-muted" />;
}

export default function AppLayout({ children }: { readonly children: ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-brand px-4 py-2 font-semibold text-brand-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur-md">
        <Container className="grid grid-cols-[1fr_auto] items-center gap-x-4 pt-3">
          <div className="flex h-11 items-center">
            <Logo />
          </div>
          <Suspense fallback={<ChromeSkeleton />}>
            <SessionChrome />
          </Suspense>
        </Container>
      </header>
      <main id="main" className="flex-1 py-10">
        <Container>{children}</Container>
      </main>
    </>
  );
}
