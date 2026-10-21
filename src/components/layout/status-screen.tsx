import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Logo } from "@/components/brand/logo";

interface StatusScreenProps {
  readonly icon: LucideIcon;
  readonly code?: string;
  readonly title: string;
  readonly description: string;
  readonly actions: ReactNode;
}

/** Full-page empty/error state, so no route ever falls through to a blank screen (§7). */
export function StatusScreen({ icon: Icon, code, title, description, actions }: StatusScreenProps) {
  return (
    <main
      id="main"
      className="flex flex-1 flex-col items-center justify-center gap-10 px-4 py-16 text-center"
    >
      <Logo />
      <div className="flex max-w-md animate-fade-up flex-col items-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-soft text-brand-strong">
          <Icon aria-hidden="true" className="size-6" />
        </span>
        {code === undefined ? null : (
          <p className="mt-6 font-mono text-sm font-semibold text-ink-subtle">{code}</p>
        )}
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-ink">{title}</h1>
        <p className="mt-3 text-pretty text-ink-muted">{description}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">{actions}</div>
      </div>
    </main>
  );
}
