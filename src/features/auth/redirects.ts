import { ROLE_HOME_PATHS, type AppRole } from "./roles";

const PLACEHOLDER_ORIGIN = "http://internal.invalid";
const MAX_PATH_LENGTH = 512;

/** Paths that would bounce a signed-in user straight back into the auth flow. */
const AUTH_FLOW_PREFIXES = ["/login", "/signup", "/forgot-password", "/auth/"] as const;

/**
 * Returns `raw` only if it is a same-site path, otherwise undefined. Guards the `next`
 * parameter against open redirects such as `//evil.example`, `/\evil.example` or
 * `https://evil.example`.
 */
export function toSafeInternalPath(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined || raw.length === 0 || raw.length > MAX_PATH_LENGTH) {
    return undefined;
  }
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return undefined;
  }
  // Reject control characters and whitespace that browsers may strip or reinterpret.
  for (const char of raw) {
    const code = char.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) {
      return undefined;
    }
  }

  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return undefined;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) {
    return undefined;
  }

  const path = `${url.pathname}${url.search}${url.hash}`;
  return AUTH_FLOW_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)) ? undefined : path;
}

/** True when `path` lies inside the area that `role` is allowed to open. */
export function isPathAllowedForRole(path: string, role: AppRole): boolean {
  const pathname = new URL(path, PLACEHOLDER_ORIGIN).pathname;
  const ownHome = ROLE_HOME_PATHS[role];
  const ownArea = role === "student" ? "/student" : ownHome;

  const restrictedAreas = ["/student", "/department", "/admin"];
  const inRestrictedArea = restrictedAreas.some(
    (area) => pathname === area || pathname.startsWith(`${area}/`),
  );

  return !inRestrictedArea || pathname === ownArea || pathname.startsWith(`${ownArea}/`);
}

/**
 * Where to send a user after they sign in: the requested page when it is safe and inside
 * their role's area, otherwise their role's home.
 */
export function postSignInPath(role: AppRole, requestedNext: string | null | undefined): string {
  const next = toSafeInternalPath(requestedNext);
  return next !== undefined && isPathAllowedForRole(next, role) ? next : ROLE_HOME_PATHS[role];
}

export function loginPathFor(requestedPath: string): string {
  const next = toSafeInternalPath(requestedPath);
  return next === undefined ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}
