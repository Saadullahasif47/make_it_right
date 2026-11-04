import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "inverse";
export type ButtonSize = "sm" | "md" | "lg";

/*
 * Hover feedback: the button lifts 1 px with a soft shadow and its arrow nudges forward; a press
 * settles it back down and darkens it. Only transform and shadow move (cheap on any laptop), and
 * with reduced motion it changes colour without lifting.
 */
const base =
  "group inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap select-none " +
  "transition-[color,background-color,border-color,box-shadow,translate] " +
  "active:translate-y-0 active:shadow-none " +
  "[&_.lucide-arrow-right]:transition-[translate] [&_.lucide-arrow-right]:duration-(--motion-base) " +
  "hover:[&_.lucide-arrow-right]:translate-x-0.5 " +
  "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

/** The lift, for buttons that sit on a surface (not the borderless ghost style). */
const lift = "motion-safe:hover:-translate-y-px";

const variants: Record<ButtonVariant, string> = {
  primary: `${lift} bg-brand text-brand-fg shadow-soft hover:bg-brand-hover hover:shadow-[0_6px_16px_-6px_rgb(24_115_93/0.5)] active:bg-brand-strong`,
  secondary: `${lift} border border-line-strong bg-surface text-ink shadow-soft hover:border-ink-subtle hover:bg-surface-muted hover:shadow-[0_6px_14px_-8px_rgb(24_45_43/0.3)] active:bg-line`,
  ghost: "text-ink-muted hover:bg-surface-muted hover:text-ink active:bg-line",
  inverse: `${lift} bg-band-fg text-band hover:bg-white active:bg-band-muted`,
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-[15px]",
};

export interface ButtonStyleOptions {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly className?: string;
}

export function buttonClassName({
  variant = "primary",
  size = "md",
  className,
}: ButtonStyleOptions = {}): string {
  return cn(base, variants[variant], sizes[size], className);
}

type ButtonProps = ComponentProps<"button"> & ButtonStyleOptions;

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} className={buttonClassName({ variant, size, className })} {...props} />
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & ButtonStyleOptions;

export function ButtonLink({ variant, size, className, ...props }: ButtonLinkProps) {
  return <Link className={buttonClassName({ variant, size, className })} {...props} />;
}

/** Icon size inside buttons. */
export const buttonIcon = "size-4";
