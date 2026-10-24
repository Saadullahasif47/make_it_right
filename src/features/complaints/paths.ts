import type { AppRole } from "@/features/auth/roles";

/** Where each role views a ticket. Redirect targets are built here, never taken from a form. */
export function ticketPathFor(role: AppRole, ticketId: string): string {
  switch (role) {
    case "student":
      return `/student/complaints/${ticketId}`;
    case "department":
      return `/department/${ticketId}`;
    case "admin":
      return `/admin/complaints/${ticketId}`;
  }
}

/** One-off confirmations shown after a workflow action (`?notice=`). */
export const WORKFLOW_NOTICES: Readonly<Record<string, string>> = {
  acknowledged: "Acknowledged. The reporter can see that the department has the ticket.",
  in_progress: "Work started. The reporter can follow progress on the timeline.",
  resolved: "Marked resolved. The reporter will be asked to confirm the fix.",
  closed: "Thanks for confirming. This ticket is now closed.",
  reopened: "Reopened. The department has been asked to take another look.",
  note: "Note added to the timeline.",
  assigned: "Ticket assigned. The department will see it in their queue.",
  "ai-routed": "The AI assistant routed this ticket. Its reason is on the timeline.",
  "ai-review": "The AI attempt finished without a route, so this ticket still needs you.",
};
