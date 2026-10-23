"use client";

import {
  CircleCheck,
  Eye,
  MessageSquarePlus,
  RotateCcw,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState, useId, type ReactNode } from "react";

import { TextAreaField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import type { AppRole } from "@/features/auth/roles";
import { IDLE_FORM_STATE, type FormState } from "@/lib/forms/form-state";

import { FAILURE_MESSAGES } from "../messages";
import type { TicketState } from "../statuses";
import {
  NOTE_LIMITS,
  NOTE_REQUIRED_FOR,
  TRANSITION_LABELS,
  allowedTargets,
  canAcknowledge,
  canAddNote,
} from "../workflow";
import {
  acknowledgeAction,
  addNoteAction,
  changeStatusAction,
  type WorkflowField,
} from "../workflow-actions";

type Action = (
  state: FormState<WorkflowField>,
  data: FormData,
) => Promise<FormState<WorkflowField>>;

interface ActionFormProps {
  readonly action: Action;
  readonly hidden: Readonly<Record<string, string>>;
  readonly submitLabel: string;
  readonly pendingLabel: string;
  readonly icon: LucideIcon;
  readonly variant?: "primary" | "secondary";
  readonly note?: { readonly label: string; readonly hint: string; readonly required: boolean };
}

/** One workflow step: hidden ids, an optional note, a submit button and inline feedback. */
function ActionForm({
  action,
  hidden,
  submitLabel,
  pendingLabel,
  icon: Icon,
  variant,
  note,
}: ActionFormProps) {
  const [state, formAction] = useActionState<FormState<WorkflowField>, FormData>(
    action,
    IDLE_FORM_STATE,
  );
  const pathname = usePathname();
  // Several forms share this page, so each needs its own field ids for labels to resolve.
  const formId = useId();
  const stale = state.message === FAILURE_MESSAGES.STALE_VERSION;

  return (
    <form action={formAction} noValidate className="space-y-3">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {state.message === undefined ? null : (
        <Notice tone="error">
          {state.message}{" "}
          {stale ? (
            <Link href={pathname} className="font-semibold underline underline-offset-4">
              Refresh
            </Link>
          ) : null}
        </Notice>
      )}
      {note === undefined ? null : (
        <TextAreaField
          id={`${formId}-note`}
          name="note"
          label={note.label}
          hint={note.hint}
          rows={3}
          required={note.required}
          maxLength={NOTE_LIMITS.max}
          defaultValue={state.values?.note}
          error={state.fieldErrors?.note}
        />
      )}
      <SubmitButton
        pendingLabel={pendingLabel}
        size="md"
        variant={variant ?? "primary"}
        className="w-full"
      >
        <Icon aria-hidden="true" className="size-4" />
        {submitLabel}
      </SubmitButton>
    </form>
  );
}

const TARGET_ICONS: Readonly<Partial<Record<TicketState, LucideIcon>>> = {
  in_progress: Wrench,
  resolved: CircleCheck,
  closed: CircleCheck,
  reopened: RotateCcw,
};

const NOTE_PROMPTS: Readonly<Partial<Record<TicketState, { label: string; hint: string }>>> = {
  resolved: {
    label: "What was done?",
    hint: "The reporter sees this note when asked to confirm the fix.",
  },
  reopened: {
    label: "What is still wrong?",
    hint: "The department sees this when they take the ticket back.",
  },
};

interface WorkflowPanelProps {
  readonly ticketId: string;
  readonly version: number;
  readonly status: TicketState;
  readonly acknowledgedAt: string | null;
  readonly role: AppRole;
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="animate-fade-up space-y-4 rounded-2xl border border-brand/30 bg-surface p-6 shadow-soft"
    >
      <h2 className="text-lg font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}

/**
 * The actions this role may take on this ticket right now. Visibility mirrors the rules in
 * workflow.ts; the database re-checks role, department, status and version on every submit.
 */
export function WorkflowPanel({
  ticketId,
  version,
  status,
  acknowledgedAt,
  role,
}: WorkflowPanelProps) {
  const ids = { ticketId, expectedVersion: String(version) };
  const targets = allowedTargets(status, role);
  const showAcknowledge = canAcknowledge({ status, acknowledgedAt }, role);
  const showNote = canAddNote(status, role);

  if (targets.length === 0 && !showAcknowledge && !showNote) {
    return null;
  }

  const reporterDecision = role === "student" && status === "resolved";

  return (
    <Section title={reporterDecision ? "Is it fixed?" : "Update this ticket"}>
      {reporterDecision ? (
        <p className="text-sm text-ink-muted">
          The department marked this as resolved. Please confirm, or tell them what is still wrong.
        </p>
      ) : null}

      {showAcknowledge ? (
        <ActionForm
          action={acknowledgeAction}
          hidden={ids}
          submitLabel="Acknowledge"
          pendingLabel="Acknowledging…"
          icon={Eye}
          variant="secondary"
        />
      ) : null}

      {targets.map((target) => {
        const prompt = NOTE_PROMPTS[target];
        return (
          <ActionForm
            key={target}
            action={changeStatusAction}
            hidden={{ ...ids, target }}
            submitLabel={TRANSITION_LABELS[target] ?? target}
            pendingLabel="Saving…"
            icon={TARGET_ICONS[target] ?? Wrench}
            variant={target === "reopened" ? "secondary" : "primary"}
            {...(prompt === undefined
              ? {}
              : { note: { ...prompt, required: NOTE_REQUIRED_FOR.includes(target) } })}
          />
        );
      })}

      {showNote ? (
        <div className="border-t border-line pt-4">
          <ActionForm
            action={addNoteAction}
            hidden={{ ticketId }}
            submitLabel="Add note"
            pendingLabel="Adding…"
            icon={MessageSquarePlus}
            variant="secondary"
            note={{
              label: "Work note",
              hint: "Visible to the reporter on the timeline. Do not include personal information.",
              required: true,
            }}
          />
        </div>
      ) : null}
    </Section>
  );
}
