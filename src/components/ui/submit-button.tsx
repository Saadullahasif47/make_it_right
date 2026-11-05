"use client";

import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { cn } from "@/lib/utils/cn";

import { buttonClassName, type ButtonStyleOptions } from "./button";

interface SubmitButtonProps extends ButtonStyleOptions {
  readonly children: ReactNode;
  readonly pendingLabel: string;
  /** For buttons whose visible text is shared by several forms on a page ("Save"). */
  readonly "aria-label"?: string;
  /** Submitted with the form when this button is the one pressed (several choices, one form). */
  readonly name?: string;
  readonly value?: string;
}

const layer = "col-start-1 row-start-1 inline-flex items-center justify-center gap-2";

/**
 * Disables itself while the surrounding form's action runs, so a double click submits once.
 *
 * Feedback without movement or layout shift: the label changes at once; the spinner fades in
 * only if the wait passes 150 ms, so quick saves never flash; both labels share one grid cell,
 * so the button keeps its width; and a polite status tells screen readers what is happening.
 */
export function SubmitButton({
  children,
  pendingLabel,
  "aria-label": ariaLabel,
  name,
  value,
  ...style
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <>
      <button
        type="submit"
        disabled={pending}
        aria-disabled={pending}
        aria-label={ariaLabel}
        name={name}
        value={value}
        className={buttonClassName({ size: "lg", ...style, className: style.className })}
      >
        <span className="grid">
          <span className={cn(layer, pending && "invisible")}>{children}</span>
          {/* Always rendered (hidden when idle), so the spinner's width is reserved too. */}
          <span className={cn(layer, !pending && "invisible")}>
            <span className={cn(pending && "animate-reveal")}>
              <LoaderCircle
                aria-hidden="true"
                className={cn("size-4", pending && "animate-spin")}
              />
            </span>
            <span>{pendingLabel}</span>
          </span>
        </span>
      </button>
      {/* A plain polite live region, not role="status": the page's own notices own that role. */}
      <span aria-live="polite" className="sr-only">
        {pending ? pendingLabel : ""}
      </span>
    </>
  );
}
