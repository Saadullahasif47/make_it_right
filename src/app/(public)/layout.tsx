import type { ReactNode } from "react";

import { PrototypeNotice } from "./_components/prototype-notice";
import { SiteFooter } from "./_components/site-footer";
import { SiteHeader } from "./_components/site-header";

export default function PublicLayout({ children }: { readonly children: ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-brand px-4 py-2 font-semibold text-brand-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <PrototypeNotice />
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
