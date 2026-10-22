"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

import { FieldShell, fieldDescriptionIds, inputClassName } from "./field";

type PasswordFieldProps = Omit<ComponentProps<"input">, "id" | "name" | "type"> & {
  readonly name: string;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly labelAside?: ReactNode;
};

export function PasswordField({
  name,
  label,
  hint,
  error,
  labelAside,
  className,
  ...props
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const id = `field-${name}`;

  return (
    <FieldShell id={id} label={label} hint={hint} error={error} labelAside={labelAside}>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={fieldDescriptionIds(id, hint, error)}
          className={cn(inputClassName, "pr-11", className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => {
            setVisible((current) => !current);
          }}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-controls={id}
          aria-pressed={visible}
          className="absolute inset-y-0 right-1 my-auto flex size-9 items-center justify-center rounded-lg text-ink-subtle transition-colors duration-200 hover:bg-surface-muted hover:text-ink"
        >
          {visible ? (
            <EyeOff aria-hidden="true" className="size-4.5" />
          ) : (
            <Eye aria-hidden="true" className="size-4.5" />
          )}
        </button>
      </div>
    </FieldShell>
  );
}
