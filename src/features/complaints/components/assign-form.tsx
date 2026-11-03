"use client";

import { Route } from "lucide-react";
import { useActionState, useState, type ComponentProps } from "react";

import { FieldShell, TextAreaField, inputClassName } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { IDLE_FORM_STATE, type FormState } from "@/lib/forms/form-state";
import { cn } from "@/lib/utils/cn";

import { CATEGORY_LABELS, COMPLAINT_CATEGORIES, type ComplaintCategory } from "../categories";
import type { Department, RoutingRule } from "../repository";
import { NOTE_LIMITS } from "../workflow";
import { assignAction, type WorkflowField } from "../workflow-actions";

interface AssignFormProps {
  readonly ticketId: string;
  readonly version: number;
  readonly departments: readonly Department[];
  readonly routingRules: readonly RoutingRule[];
  readonly current: {
    readonly category: string;
    readonly priority: string;
    readonly departmentId: string | null;
  };
  /** The AI's suggestion from a run that ended in review, used to pre-fill an unrouted ticket. */
  readonly suggestion?: {
    readonly category: string | null;
    readonly priority: string | null;
    readonly departmentId: string | null;
  };
}

const PRIORITIES = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
] as const;

function Select({
  name,
  label,
  error,
  ...props
}: ComponentProps<"select"> & {
  readonly name: string;
  readonly label: string;
  readonly error?: string | undefined;
}) {
  const id = `field-${name}`;
  return (
    <FieldShell id={id} label={label} error={error}>
      <select
        id={id}
        name={name}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        className={cn(inputClassName, "appearance-auto pr-3")}
        {...props}
      />
    </FieldShell>
  );
}

/**
 * Admin classification and routing. Picking a category pre-selects its default department from
 * the routing rules until the admin chooses a department by hand.
 */
export function AssignForm({
  ticketId,
  version,
  departments,
  routingRules,
  current,
  suggestion,
}: AssignFormProps) {
  const [state, formAction] = useActionState<FormState<WorkflowField>, FormData>(
    assignAction,
    IDLE_FORM_STATE,
  );
  const ruleFor = (category: string) =>
    routingRules.find((rule) => rule.category === category && rule.enabled)?.departmentId;

  const unrouted = current.category === "unclassified";
  const suggestedDepartment = departments.some((d) => d.id === suggestion?.departmentId)
    ? suggestion?.departmentId
    : undefined;
  const [category, setCategory] = useState(
    unrouted ? (suggestion?.category ?? "") : current.category,
  );
  const [departmentId, setDepartmentId] = useState(
    current.departmentId ?? (unrouted ? suggestedDepartment : undefined) ?? ruleFor(category) ?? "",
  );
  const initialPriority =
    current.priority === "unassessed" ? (suggestion?.priority ?? "") : current.priority;
  const [departmentTouched, setDepartmentTouched] = useState(current.departmentId !== null);

  return (
    <section
      aria-label="Route this ticket"
      className="animate-fade-up space-y-4 rounded-2xl border border-brand/30 bg-surface p-6 shadow-soft"
    >
      <h2 className="text-lg font-bold text-ink">Route this ticket</h2>
      <p className="text-sm text-ink-muted">
        Classify the report and choose the department that should fix it.
        {suggestion === undefined
          ? " With AI switched off, this is how every ticket reaches a department."
          : " The form starts from the AI assistant's suggestion; check it before assigning."}
      </p>
      <form action={formAction} noValidate className="space-y-4">
        <input type="hidden" name="ticketId" value={ticketId} />
        <input type="hidden" name="expectedVersion" value={String(version)} />
        {state.message === undefined ? null : <Notice tone="error">{state.message}</Notice>}

        <Select
          name="category"
          label="Category"
          value={category}
          error={state.fieldErrors?.category}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setCategory(next);
            const suggested = ruleFor(next);
            if (!departmentTouched && suggested !== undefined) {
              setDepartmentId(suggested);
            }
          }}
        >
          <option value="" disabled>
            Choose a category
          </option>
          {COMPLAINT_CATEGORIES.map((value: ComplaintCategory) => (
            <option key={value} value={value}>
              {CATEGORY_LABELS[value]}
            </option>
          ))}
        </Select>

        <Select
          name="departmentId"
          label="Department"
          value={departmentId}
          error={state.fieldErrors?.departmentId}
          onChange={(event) => {
            setDepartmentId(event.currentTarget.value);
            setDepartmentTouched(true);
          }}
        >
          <option value="" disabled>
            Choose a department
          </option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
              {ruleFor(category) === department.id ? " (default for this category)" : ""}
            </option>
          ))}
        </Select>

        <Select
          name="priority"
          label="Priority"
          defaultValue={initialPriority === "unassessed" ? "" : initialPriority}
          error={state.fieldErrors?.priority}
        >
          <option value="" disabled>
            Choose a priority
          </option>
          {PRIORITIES.map((priority) => (
            <option key={priority.value} value={priority.value}>
              {priority.label}
            </option>
          ))}
        </Select>

        <TextAreaField
          id="assign-note"
          name="note"
          label="Note (optional)"
          hint="Shown on the timeline, for example why the ticket was re-routed."
          rows={2}
          maxLength={NOTE_LIMITS.max}
          defaultValue={state.values?.note}
          error={state.fieldErrors?.note}
        />

        <SubmitButton pendingLabel="Assigning…" size="md" className="w-full">
          <Route aria-hidden="true" className="size-4" />
          {current.departmentId === null ? "Assign ticket" : "Reassign ticket"}
        </SubmitButton>
      </form>
    </section>
  );
}
