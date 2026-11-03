import Link from "next/link";
import type { ReactNode } from "react";

interface AuthCardProps {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <div className="w-full max-w-[25rem]">
      <div className="rounded-xl border border-line bg-surface p-6 shadow-soft sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-1.5 text-sm text-pretty text-ink-muted">{description}</p>
        <div className="mt-7">{children}</div>
      </div>
      {footer === undefined ? null : (
        <p className="mt-6 text-center text-sm text-ink-muted">{footer}</p>
      )}
    </div>
  );
}

/** Placeholder with the same footprint as a form, shown while the session is read. */
export function FormSkeleton({ fields }: { readonly fields: number }) {
  return (
    <div aria-hidden="true" className="space-y-5">
      {Array.from({ length: fields }, (_, index) => (
        <div key={index} className="space-y-2">
          <div className="h-4 w-24 animate-pulse rounded bg-line" />
          <div className="h-10 animate-pulse rounded-md bg-line" />
        </div>
      ))}
      <div className="h-11 animate-pulse rounded-lg bg-line" />
    </div>
  );
}

export function TextLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return (
    <Link href={href} className="font-medium text-brand underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}
