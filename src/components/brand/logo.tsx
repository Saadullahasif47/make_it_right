import Link from "next/link";

import { cn } from "@/lib/utils/cn";

export const PRODUCT_NAME = "MakeItRight";
export const PRODUCT_TAGLINE = "AI Cloud-Based University Complaint System";

/** Brand mark: a check on the brand tile, i.e. "reported, then fixed". */
export function LogoMark({ className }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8", className)}>
      <rect width="32" height="32" rx="8" className="fill-brand" />
      <path
        d="M9 16.5l4.5 4.5L23 11.5"
        fill="none"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-brand-fg"
      />
    </svg>
  );
}

type LogoTone = "default" | "inverse" | "sidebar";

const TONES: Readonly<Record<LogoTone, { word: string; accent: string }>> = {
  default: { word: "text-ink", accent: "text-brand" },
  /** On a dark surface. */
  inverse: { word: "text-band-fg", accent: "text-brand-on-band" },
  /** Light in the mobile top bar, dark in the desktop sidebar. */
  sidebar: { word: "text-ink lg:text-band-fg", accent: "text-brand lg:text-brand-on-band" },
};

interface LogoProps {
  readonly className?: string;
  readonly tone?: LogoTone;
}

export function Logo({ className, tone = "default" }: LogoProps) {
  const colours = TONES[tone];
  return (
    <Link
      href="/"
      aria-label={`${PRODUCT_NAME} home`}
      className={cn("inline-flex items-center gap-2.5 rounded-md", className)}
    >
      <LogoMark className="size-7" />
      <span className={cn("text-[17px] font-semibold tracking-tight", colours.word)}>
        MakeIt<span className={colours.accent}>Right</span>
      </span>
    </Link>
  );
}
