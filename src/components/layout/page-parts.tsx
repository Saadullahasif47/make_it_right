import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/** Title, one line of context and (optionally) the page's primary action, aligned on desktop. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  readonly title: string;
  readonly description: string;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-balance text-ink sm:text-[1.75rem]">
          {title}
        </h1>
        <p className="mt-1.5 max-w-2xl text-[15px] text-pretty text-ink-muted">{description}</p>
      </div>
      {actions === undefined ? null : (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

/** A bordered surface. Panels rest on their border; only floating layers get a shadow. */
export function Panel({
  className,
  children,
  ...props
}: {
  readonly className?: string;
  readonly children: ReactNode;
  readonly "aria-label"?: string;
  readonly "aria-labelledby"?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-line bg-surface", className)} {...props}>
      {children}
    </section>
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
      className="flex flex-col items-center rounded-xl border border-dashed border-line-strong bg-surface px-6 py-12 text-center"
    >
      <span className="flex size-10 items-center justify-center rounded-lg bg-surface-muted text-ink-muted">
        <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </span>
      <h2 className="mt-4 text-base font-semibold text-ink">{title}</h2>
      <div className="mt-1.5 max-w-md text-sm text-pretty text-ink-muted">{children}</div>
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
    <div className={cn("rounded-xl border border-line bg-surface p-5", className)}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink-muted">{label}</p>
        <Icon aria-hidden="true" className="size-4 text-ink-subtle" strokeWidth={1.75} />
      </div>
      <p className="mt-2 text-[1.75rem] leading-none font-semibold tracking-tight text-ink tabular-nums">
        {value}
      </p>
    </div>
  );
}

/** Placeholder blocks with the shape of the real content, so nothing jumps when it arrives. */
export function Skeleton({ className }: { readonly className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-line", className)} />;
}

/** Rows shaped like a ticket list: reference, title and status. */
export function SkeletonRows() {
  return (
    <div
      aria-hidden="true"
      className="space-y-px overflow-hidden rounded-xl border border-line bg-surface"
    >
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-6 w-20" />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-8">
      <div className="space-y-2.5">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <SkeletonRows />
    </div>
  );
}
