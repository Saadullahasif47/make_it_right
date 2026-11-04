import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "inverse";
export type ButtonSize = "sm" | "md" | "lg";

/*
 * Feedback is colour only: 150 ms on hover, a darker shade on press. Buttons never move, scale or
 * shimmer, so a busy screen stays calm.
 */
const base =
  "group inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap select-none " +
  "transition-colors " +
  "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-fg shadow-soft hover:bg-brand-hover active:bg-brand-strong",
  secondary:
    "border border-line-strong bg-surface text-ink shadow-soft hover:border-ink-subtle hover:bg-surface-muted active:bg-line",
  ghost: "text-ink-muted hover:bg-surface-muted hover:text-ink active:bg-line",
  inverse: "bg-band-fg text-band hover:bg-white active:bg-band-muted",
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
