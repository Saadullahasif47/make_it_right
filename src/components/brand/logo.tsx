import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils/cn";

import logoOnDark from "../../../public/brand/makeitright-logo-on-dark.png";
import logoOnLight from "../../../public/brand/makeitright-logo.png";

export const PRODUCT_NAME = "MakeItRight";
export const PRODUCT_TAGLINE = "AI Cloud-Based University Complaint System";

type LogoTone = "default" | "inverse" | "sidebar";

/**
 * Which artwork shows where. The logo's lettering is dark forest green, so dark surfaces (the
 * desktop sidebar, the sign-in panel, the opt-in dark theme) use the version with light lettering.
 */
const ARTWORK: Readonly<Record<LogoTone, { light: string; dark: string }>> = {
  default: { light: "block dark:hidden", dark: "hidden dark:block" },
  /** Always on a dark surface. */
  inverse: { light: "hidden", dark: "block" },
  /** The light mobile top bar, then the dark desktop sidebar. */
  sidebar: { light: "block dark:hidden lg:hidden", dark: "hidden dark:block lg:block" },
};

/** Display height 36 px; declared at that size so the browser fetches a small optimised file. */
const HEIGHT = 36;
const WIDTH = Math.round((logoOnLight.width / logoOnLight.height) * HEIGHT);

interface LogoProps {
  readonly className?: string;
  readonly tone?: LogoTone;
  /** Above-the-fold logos load first. */
  readonly priority?: boolean;
}

export function Logo({ className, tone = "default", priority = false }: LogoProps) {
  const artwork = ARTWORK[tone];
  const image = "h-8 w-auto sm:h-9";
  return (
    <Link
      href="/"
      aria-label={`${PRODUCT_NAME} home`}
      className={cn("inline-flex shrink-0 items-center rounded-md", className)}
    >
      {/* The link is named; both images are decorative alternatives of one mark. */}
      <Image
        src={logoOnLight}
        alt=""
        width={WIDTH}
        height={HEIGHT}
        priority={priority}
        className={cn(image, artwork.light)}
      />
      <Image
        src={logoOnDark}
        alt=""
        width={WIDTH}
        height={HEIGHT}
        priority={priority}
        className={cn(image, artwork.dark)}
      />
    </Link>
  );
}
