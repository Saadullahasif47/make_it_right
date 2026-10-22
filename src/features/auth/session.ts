import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { loginPathFor } from "./redirects";
import { isAppRole, type AppRole } from "./roles";

export interface SessionUser {
  readonly id: string;
  readonly email: string | undefined;
  readonly displayName: string | null;
  readonly role: AppRole;
  readonly departmentId: string | null;
}

/** Thrown when the session exists but the profile lookup itself failed (not "signed out"). */
export class SessionLookupError extends Error {
  override readonly name = "SessionLookupError";
}

/**
 * The single source of "who is this request" (data access layer). The token is verified by
 * Supabase and the role is read from the database on every request, never from the token or
 * the client. Deduplicated per request with React `cache`.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.getClaims();
  if (error !== null || data === null) {
    return null;
  }

  const { sub, email } = data.claims;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, display_name, department_id")
    .eq("id", sub)
    .maybeSingle();

  if (profileError !== null) {
    throw new SessionLookupError("Profile lookup failed.");
  }
  if (profile === null || !isAppRole(profile.role)) {
    return null;
  }

  return {
    id: sub,
    email: typeof email === "string" ? email : undefined,
    displayName: profile.display_name,
    role: profile.role,
    departmentId: profile.department_id,
  };
});

export type PageAccess =
  | { readonly kind: "granted"; readonly user: SessionUser }
  | { readonly kind: "forbidden"; readonly user: SessionUser };

/**
 * Authorises a page render. Signed-out visitors are redirected to sign in and brought back
 * afterwards; signed-in users with the wrong role get a "forbidden" result to render.
 */
export async function requirePageAccess(
  allowedRoles: readonly AppRole[],
  currentPath: string,
): Promise<PageAccess> {
  const user = await getSessionUser();
  if (user === null) {
    redirect(loginPathFor(currentPath));
  }
  return allowedRoles.includes(user.role) ? { kind: "granted", user } : { kind: "forbidden", user };
}
