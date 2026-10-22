import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "inverse";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "group inline-flex shrink-0 items-center justify-center gap-2 rounded-xl font-semibold whitespace-nowrap select-none " +
  "transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-(--ease-out-soft) " +
  "hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] " +
  "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  primary: "btn-sheen bg-brand text-brand-fg shadow-soft hover:bg-brand-hover hover:shadow-lift",
  secondary:
    "border border-line-strong bg-surface text-ink shadow-soft hover:border-brand hover:text-brand-strong hover:shadow-lift",
  ghost: "text-ink-muted hover:bg-surface-muted hover:text-ink",
  inverse: "btn-sheen bg-band-fg text-band shadow-soft hover:shadow-lift hover:bg-white",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-base",
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

/** Icon that nudges forward when its parent button is hovered. */
export const buttonIconSlide =
  "size-4 transition-transform duration-200 ease-(--ease-out-soft) group-hover:translate-x-0.5";
