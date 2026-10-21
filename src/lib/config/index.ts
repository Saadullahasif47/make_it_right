import "server-only";

import { parseServerConfig, type ServerConfig } from "./server-config";

export { ConfigError, type LogLevel, type ServerConfig } from "./server-config";

let cached: ServerConfig | undefined;

/**
 * The one place the application reads process.env. Parsed once per server instance;
 * a ConfigError here means the deployment is misconfigured, not that a request is bad.
 */
export function getServerConfig(): ServerConfig {
  cached ??= parseServerConfig(process.env);
  return cached;
}
