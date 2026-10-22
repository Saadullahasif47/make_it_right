import "server-only";

import { headers } from "next/headers";

import { getServerConfig } from "@/lib/config";

const HOST_PATTERN = /^[a-z0-9.-]+(:\d{1,5})?$/i;

/**
 * The origin to put into links we email (confirmation, password reset). Production pins it
 * with APP_BASE_URL; previews derive it from the request. Supabase only honours redirect
 * URLs on its allow-list, so a forged Host header cannot send users elsewhere.
 */
export async function getAppOrigin(): Promise<string> {
  const configured = getServerConfig().appBaseUrl;
  if (configured !== undefined) {
    return new URL(configured).origin;
  }

  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (host === null || !HOST_PATTERN.test(host)) {
    throw new Error("Cannot determine the application origin.");
  }
  const protocol = requestHeaders.get("x-forwarded-proto") === "https" ? "https" : "http";
  return `${protocol}://${host}`;
}
