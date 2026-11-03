"use client";

import { Power, Save } from "lucide-react";
import { useActionState, useId } from "react";

import { inputClassName } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { IDLE_FORM_STATE } from "@/lib/forms/form-state";
import { cn } from "@/lib/utils/cn";

import { saveRoutingRuleAction, toggleDepartmentAction } from "../actions";

/** Activates or deactivates one department; the database records who did it and when. */
export function DepartmentToggleForm({
  departmentId,
  name,
  active,
}: {
  readonly departmentId: string;
  readonly name: string;
  readonly active: boolean;
}) {
  const [state, formAction] = useActionState(toggleDepartmentAction, IDLE_FORM_STATE);
  return (
    <form action={formAction} className="flex flex-col items-end gap-2">
      <input type="hidden" name="departmentId" value={departmentId} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      {state.message === undefined ? null : <Notice tone="error">{state.message}</Notice>}
      <SubmitButton
        pendingLabel={active ? "Deactivating…" : "Activating…"}
        size="sm"
        variant="secondary"
        aria-label={`${active ? "Deactivate" : "Activate"} ${name}`}
      >
        <Power aria-hidden="true" className="size-3.5" />
        {active ? "Deactivate" : "Activate"}
      </SubmitButton>
    </form>
  );
}

/** One category's default department and whether the rule is in force. */
export function RoutingRuleForm({
  category,
  label,
  departments,
  current,
}: {
  readonly category: string;
  readonly label: string;
  readonly departments: readonly {
    readonly id: string;
    readonly name: string;
    readonly isActive: boolean;
  }[];
  readonly current: { readonly departmentId: string; readonly enabled: boolean } | null;
}) {
  const [state, formAction] = useActionState(saveRoutingRuleAction, IDLE_FORM_STATE);
  const id = useId();
  return (
    <form
      action={formAction}
      className="grid gap-3 py-4 sm:grid-cols-[9rem_1fr_9rem_auto] sm:items-center"
    >
      <input type="hidden" name="category" value={category} />
      <p className="font-semibold text-ink">{label}</p>
      <div>
        <label htmlFor={`${id}-department`} className="sr-only">
          Department for {label}
        </label>
        <select
          id={`${id}-department`}
          name="departmentId"
          defaultValue={current?.departmentId ?? ""}
          className={cn(inputClassName, "appearance-auto pr-3")}
          required
        >
          <option value="" disabled>
            Choose a department
          </option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
              {department.isActive ? "" : " (inactive)"}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-enabled`} className="sr-only">
          Rule status for {label}
        </label>
        <select
          id={`${id}-enabled`}
          name="enabled"
          defaultValue={current === null || current.enabled ? "true" : "false"}
          className={cn(inputClassName, "appearance-auto pr-3")}
        >
          <option value="true">Enabled</option>
          <option value="false">Disabled</option>
        </select>
      </div>
      <SubmitButton pendingLabel="Saving…" size="sm" aria-label={`Save routing for ${label}`}>
        <Save aria-hidden="true" className="size-3.5" />
        Save
      </SubmitButton>
      {state.message === undefined ? null : (
        <div className="sm:col-span-4">
          <Notice tone="error">{state.message}</Notice>
        </div>
      )}
    </form>
  );
}
