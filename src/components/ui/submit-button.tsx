"use client";

import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { buttonClassName, type ButtonStyleOptions } from "./button";

interface SubmitButtonProps extends ButtonStyleOptions {
  readonly children: ReactNode;
  readonly pendingLabel: string;
}

/** Disables itself while the surrounding form's action runs, so a double click submits once. */
export function SubmitButton({ children, pendingLabel, ...style }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
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
