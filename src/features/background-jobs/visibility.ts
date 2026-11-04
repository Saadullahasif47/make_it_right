import "server-only";

import { getServerConfig } from "@/lib/config";

/**
 * The AI jobs panel exists only once a feature that queues work is switched on, so a
 * deployment with every flag OFF looks exactly as before (plan v2 A0.02). The heatmap queues
 * nothing, so it does not count.
 */
export function aiJobsPanelEnabled(): boolean {
  const { features } = getServerConfig();
  return (
    features.visualInspection ||
    features.duplicateDetection ||
    features.maintenanceCoordinator ||
    features.repairVerification ||
    features.maintenanceInsights
  );
}
