import Link from "next/link";

import { cn } from "@/lib/utils/cn";

export const PRODUCT_NAME = "MakeItRight";
export const PRODUCT_TAGLINE = "AI Cloud-Based University Complaint System";

/** Brand mark: a ticket tab whose notch completes a check, i.e. "reported, then fixed". */
export function LogoMark({ className }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8", className)}>
      <rect width="32" height="32" rx="9" className="fill-brand" />
      <path
        d="M9 16.5l4.5 4.5L23 11.5"
        fill="none"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-brand-fg"
      />
      <circle cx="24.5" cy="7.5" r="3" className="fill-accent" />
    </svg>
  );
}

interface LogoProps {
  readonly className?: string;
  /** For dark brand surfaces (the ink band). */
  readonly inverse?: boolean;
}

export function Logo({ className, inverse = false }: LogoProps) {
  return (
    <Link
      href="/"
      aria-label={`${PRODUCT_NAME} home`}
      className={cn("group inline-flex items-center gap-2.5", className)}
    >
      <LogoMark className="transition-transform duration-300 ease-(--ease-out-soft) group-hover:scale-105 group-hover:-rotate-6" />
      <span
        className={cn(
          "text-lg font-extrabold tracking-tight",
          inverse ? "text-band-fg" : "text-ink",
        )}
      >
        MakeIt<span className={inverse ? "text-brand-on-band" : "text-brand"}>Right</span>
      </span>
    </Link>
  );
}
