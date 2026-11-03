import { CircleCheck, Info } from "lucide-react";
import type { ReactNode } from "react";

import { Logo } from "@/components/brand/logo";

const ASSURANCES = [
  "Your report is saved before any AI step runs",
  "Only you and the assigned department can see it",
  "Every status change is recorded on a timeline",
] as const;

export default function AuthLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="grid min-h-full flex-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="hidden flex-col justify-between bg-band px-12 py-10 text-band-fg lg:flex">
        <Logo tone="inverse" />

        <div className="max-w-sm">
          <p className="text-[1.75rem] leading-tight font-semibold tracking-tight text-balance">
            Report it once. Follow it until it is fixed.
          </p>
          <ul className="mt-8 space-y-3.5">
            {ASSURANCES.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm text-band-muted">
                <CircleCheck
                  aria-hidden="true"
                  className="mt-px size-4 shrink-0 text-brand-on-band"
                  strokeWidth={1.75}
                />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="flex items-center gap-2 text-xs text-band-muted">
          <Info aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
          Coursework prototype. Use fictional details only.
        </p>
      </aside>

      <main id="main" className="flex flex-col items-center justify-center px-4 py-12 sm:px-8">
        <div className="mb-8 lg:hidden">
          <Logo />
        </div>
        {children}
        <p className="mt-10 flex items-center gap-2 text-xs text-ink-subtle lg:hidden">
          <Info aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
          Coursework prototype. Use fictional details only.
        </p>
      </main>
    </div>
  );
}
