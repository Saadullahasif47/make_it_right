import type { ReactNode } from "react";
import { Suspense } from "react";

import { Logo } from "@/components/brand/logo";
import { Skeleton } from "@/components/layout/page-parts";
import { AccountMenu } from "@/features/auth/components/account-menu";
import { NavLinks } from "@/features/auth/components/nav-links";
import { getSessionUser } from "@/features/auth/session";

/**
 * Role-aware chrome. Rendering it is cosmetic; each page authorises itself on the server.
 * The nav and account block are single elements whose order and styling change at `lg`, so
 * there is exactly one navigation landmark and one sign-out button at every width.
 */
async function SessionChrome() {
  const user = await getSessionUser();
  if (user === null) {
    return null;
  }

  return (
    <>
      <nav
        aria-label="Workspace"
        className="order-3 min-w-0 basis-full border-t border-line lg:order-none lg:basis-auto lg:border-t-0 lg:pt-2"
      >
        <NavLinks role={user.role} />
      </nav>
      <div className="order-2 ml-auto pr-2 lg:order-none lg:mt-auto lg:ml-0 lg:pr-0">
        <AccountMenu user={user} />
      </div>
    </>
  );
}

function ChromeSkeleton() {
  return (
    <div className="order-2 ml-auto flex items-center gap-2.5 lg:order-none lg:mt-auto lg:ml-0 lg:px-4 lg:py-4">
      <Skeleton className="h-4 w-20 lg:bg-band-active" />
      <Skeleton className="size-8 rounded-full lg:bg-band-active" />
    </div>
  );
}

export default function AppLayout({ children }: { readonly children: ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 flex flex-wrap items-center border-b border-line bg-surface lg:fixed lg:inset-y-0 lg:left-0 lg:w-60 lg:flex-col lg:flex-nowrap lg:items-stretch lg:border-r lg:border-b-0 lg:border-band-line lg:bg-band">
        <div className="order-1 flex h-14 items-center px-4 lg:order-none lg:h-16 lg:px-5">
          <Logo tone="sidebar" priority />
        </div>
        <Suspense fallback={<ChromeSkeleton />}>
          <SessionChrome />
        </Suspense>
      </header>
      <main id="main" className="flex-1 lg:pl-60">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          {children}
        </div>
      </main>
    </>
  );
}
