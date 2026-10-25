import "server-only";

import { getTriageRunner, submissionTriage } from "@/features/agent/instance";
import { retryTriage } from "@/features/agent/retry";
import { getSessionUser } from "@/features/auth/session";
import { getLogger } from "@/lib/logging";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { createComplaintsApi } from "./api";

/** The production wiring of the complaints API, shared by its route handlers. */
export const complaintsApi = createComplaintsApi({
  getActor: getSessionUser,
  getClient: createSupabaseServerClient,
  getLogger,
  getTriage: submissionTriage,
  retryAi: (actor, ticketId, logger) =>
    retryTriage({ run: getTriageRunner(), logger }, actor, ticketId),
});
