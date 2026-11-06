import "server-only";

import { ClipboardCheck } from "lucide-react";
import Link from "next/link";

import { LocalTime } from "@/components/ui/local-time";
import type { AppSupabaseClient } from "@/lib/supabase/server";

import { priorityLabel, reasonLabel } from "../labels";
import { listPendingProposals } from "../repository";

/**
 * Work orders the coordinator proposed and a person must approve (plan v2 A4.03), oldest first.
 * Each one links to the ticket page that holds the approval panel.
 */
export async function PendingProposals({ client }: { readonly client: AppSupabaseClient }) {
  const proposals = await listPendingProposals(client);
  if (proposals.length === 0) return null;
  return (
    <section
      aria-labelledby="pending-proposals-title"
      className="space-y-3 rounded-xl border border-line bg-surface p-6"
    >
      <h2
        id="pending-proposals-title"
        className="flex items-center gap-2 text-lg font-semibold text-ink"
      >
        <ClipboardCheck aria-hidden="true" className="size-5 shrink-0 text-brand" />
        Work orders awaiting approval
        <span className="text-sm font-normal text-ink-muted">({proposals.length})</span>
      </h2>
      <ul className="divide-y divide-line">
        {proposals.map((proposal) => (
          <li key={proposal.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
            <p className="text-sm text-ink">
              {proposal.complaintId === null ? (
                <span className="font-mono">{proposal.caseReference}</span>
              ) : (
                <Link
                  href={`/admin/complaints/${proposal.complaintId}`}
                  className="underline decoration-line-strong underline-offset-4 hover:decoration-ink"
                >
                  <span className="font-mono">{proposal.caseReference}</span> {proposal.title}
                </Link>
              )}{" "}
              <span className="text-ink-muted">
                → {proposal.department}, {priorityLabel(proposal.priority).toLowerCase()} priority ·
                proposed <LocalTime value={proposal.createdAt} />
              </span>
            </p>
            <p className="text-xs text-ink-muted">
              {proposal.policyReasons.map(reasonLabel).join(" · ")}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
