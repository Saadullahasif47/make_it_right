import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export function PageHeader({
  eyebrow,
  title,
  description,
}: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <header className="animate-fade-up">
      {eyebrow === undefined ? null : (
        <p className="text-sm font-semibold tracking-wide text-brand uppercase">{eyebrow}</p>
      )}
      <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-ink">{title}</h1>
      <p className="mt-2 max-w-2xl text-pretty text-ink-muted">{description}</p>
    </header>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="flex animate-fade-up flex-col items-center rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-14 text-center"
    >
      <span className="flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand-strong">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <h2 className="mt-5 text-lg font-bold text-ink">{title}</h2>
      <div className="mt-2 max-w-md text-sm text-pretty text-ink-muted">{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  icon: Icon,
  className,
}: {
  readonly label: string;
  readonly value: number;
  readonly icon: LucideIcon;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "group rounded-2xl border border-line bg-surface p-5 shadow-soft transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lift",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink-muted">{label}</p>
        <Icon
          aria-hidden="true"
          className="size-4 text-ink-subtle transition-colors duration-300 group-hover:text-brand"
        />
      </div>
      <p className="mt-3 text-3xl font-extrabold tracking-tight text-ink tabular-nums">{value}</p>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-6">
      <div className="space-y-3">
        <div className="h-8 w-64 animate-pulse rounded-lg bg-surface-muted" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-surface-muted" />
      </div>
      <div className="h-48 animate-pulse rounded-2xl bg-surface-muted" />
    </div>
  );
}
