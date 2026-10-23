import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export const inputClassName =
  "h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 text-[15px] text-ink shadow-soft " +
  "placeholder:text-ink-subtle transition-[border-color,box-shadow] duration-200 " +
  "hover:border-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15 focus:outline-none " +
  "aria-invalid:border-danger aria-invalid:focus:ring-danger/15 disabled:opacity-60";

interface FieldShellProps {
  readonly id: string;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly labelAside?: ReactNode;
  readonly children: ReactNode;
}

export function fieldDescriptionIds(id: string, hint?: string, error?: string): string | undefined {
  const ids = [
    hint === undefined ? null : `${id}-hint`,
    error === undefined ? null : `${id}-error`,
  ];
  const joined = ids.filter((value) => value !== null).join(" ");
  return joined === "" ? undefined : joined;
}

/** Label, optional hint and error message wired up for assistive technology. */
export function FieldShell({ id, label, hint, error, labelAside, children }: FieldShellProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {label}
        </label>
        {labelAside}
      </div>
      {children}
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={`${id}-error`} className="animate-fade-up text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

type TextFieldProps = Omit<ComponentProps<"input">, "id" | "name"> & {
  /** Must be unique on the page; defaults to `field-<name>`, which suits one-form pages. */
  readonly id?: string;
  readonly name: string;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
};

export function TextField({
  id: idProp,
  name,
  label,
  hint,
  error,
  className,
  ...props
}: TextFieldProps) {
  const id = idProp ?? `field-${name}`;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        name={name}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={fieldDescriptionIds(id, hint, error)}
        className={cn(inputClassName, className)}
        {...props}
      />
    </FieldShell>
  );
}

type TextAreaFieldProps = Omit<ComponentProps<"textarea">, "id" | "name"> & {
  /** Must be unique on the page; pass one whenever a page holds several forms. */
  readonly id?: string;
  readonly name: string;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly labelAside?: ReactNode;
};

export function TextAreaField({
  id: idProp,
  name,
  label,
  hint,
  error,
  labelAside,
  className,
  ...props
}: TextAreaFieldProps) {
  const id = idProp ?? `field-${name}`;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} labelAside={labelAside}>
      <textarea
        id={id}
        name={name}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={fieldDescriptionIds(id, hint, error)}
        className={cn(inputClassName, "h-auto min-h-36 resize-y py-3 leading-relaxed", className)}
        {...props}
      />
    </FieldShell>
  );
}
