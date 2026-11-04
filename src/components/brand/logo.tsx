import Link from "next/link";

import { cn } from "@/lib/utils/cn";

export const PRODUCT_NAME = "MakeItRight";
export const PRODUCT_TAGLINE = "AI Cloud-Based University Complaint System";

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
    // The wordmark alone: "MakeIt" in ink, "Right" in the accent.
    <Link
      href="/"
      aria-label={`${PRODUCT_NAME} home`}
      className={cn("inline-flex items-center rounded-md", className)}
    >
      <span className={cn("text-lg font-semibold tracking-tight", colours.word)}>
        MakeIt<span className={colours.accent}>Right</span>
      </span>
    </Link>
  );
}
