import "server-only";

import { parseServerConfig, type FeatureFlag, type ServerConfig } from "./server-config";

export {
  ConfigError,
  FEATURE_ENV,
  type FeatureFlag,
  type FeatureFlags,
  type LogLevel,
  type ServerConfig,
} from "./server-config";

let cached: ServerConfig | undefined;

/**
 * The one place the application reads process.env. Parsed once per server instance;
 * a ConfigError here means the deployment is misconfigured, not that a request is bad.
 */
export function getServerConfig(): ServerConfig {
  cached ??= parseServerConfig(process.env);
  return cached;
}

/** Whether an advanced feature (plan v2 F1-F6) is switched on for this deployment. */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return getServerConfig().features[flag];
}
