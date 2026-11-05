import "server-only";

import { isFeatureEnabled } from "@/lib/config";
import type { Logger } from "@/lib/logging/logger";
import type { AppSupabaseClient } from "@/lib/supabase/server";

/**
 * After a new report is saved (and triaged), queue its duplicate check while
 * FEATURE_DUPLICATE_DETECTION is on (plan v2 F2.02). Best effort: the report is already stored,
 * and a report without a check simply keeps its own case.
 */
export function duplicateCheckAfterSubmit(
  client: AppSupabaseClient,
  logger: Logger,
): ((ticketId: string) => Promise<void>) | undefined {
  if (!isFeatureEnabled("duplicateDetection")) {
    return undefined;
  }
  return async (ticketId) => {
    const { error } = await client.rpc("request_duplicate_check", { p_complaint_id: ticketId });
    if (error === null) {
      logger.info("duplicates.check_queued", { complaintId: ticketId });
    } else {
      logger.warn("duplicates.check_not_queued", { complaintId: ticketId, code: error.code });
    }
  };
}
