"use client";

import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { buttonClassName, type ButtonStyleOptions } from "./button";

interface SubmitButtonProps extends ButtonStyleOptions {
  readonly children: ReactNode;
  readonly pendingLabel: string;
  /** For buttons whose visible text is shared by several forms on a page ("Save"). */
  readonly "aria-label"?: string;
}

/** Disables itself while the surrounding form's action runs, so a double click submits once. */
export function SubmitButton({
  children,
  pendingLabel,
  "aria-label": ariaLabel,
  ...style
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      aria-label={ariaLabel}
      className={buttonClassName({ size: "lg", ...style, className: style.className })}
    >
      {pending ? (
        <>
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          <span>{pendingLabel}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
