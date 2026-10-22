import "server-only";

import { getServerConfig } from "@/lib/config";

import { createLogger, type Logger } from "./logger";

export { createLogger, redact, type Logger, type LogFields } from "./logger";
export { REQUEST_ID_HEADER, createRequestId, resolveRequestId } from "./request-id";

let rootLogger: Logger | undefined;

export function getLogger(): Logger {
  rootLogger ??= createLogger({ level: getServerConfig().logLevel });
  return rootLogger;
}
