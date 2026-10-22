import { CircleCheck, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { Logo } from "@/components/brand/logo";

const ASSURANCES = [
  "Your report is saved before any AI step runs",
  "Only you and the assigned department can see it",
  "Every status change is recorded on a timeline",
] as const;

export default function AuthLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="grid min-h-full flex-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-band px-12 py-12 text-band-fg lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -top-32 -right-24 size-96 rounded-full bg-brand/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-24 size-80 rounded-full bg-accent/10 blur-3xl" />

        <div className="relative">
          <Logo inverse />
        </div>

        <div className="relative max-w-md">
          <h2 className="animate-fade-up text-4xl leading-tight font-extrabold tracking-tight text-balance">
            Report it once. Follow it until it is fixed.
          </h2>
          <ul className="mt-8 space-y-4">
            {ASSURANCES.map((item, index) => (
              <li
                key={item}
                className="flex animate-step-in items-start gap-3 text-band-muted"
                style={{ animationDelay: `${200 + index * 120}ms` }}
              >
                <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative flex items-center gap-2 text-sm text-band-muted">
          <ShieldCheck aria-hidden="true" className="size-4 text-accent" />
          Coursework prototype. Use fictional details only.
        </p>
      </aside>

      <main id="main" className="flex flex-col items-center justify-center px-4 py-12 sm:px-8">
        <div className="mb-10 lg:hidden">
          <Logo />
        </div>
        {children}
      </main>
    </div>
  );
}
