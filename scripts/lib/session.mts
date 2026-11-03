/**
 * Shared helpers for the Phase 6 scripts: temporary fictional accounts and browser-identical
 * session cookies. Nothing here is used by the application.
 */
import { randomUUID } from "node:crypto";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../src/lib/supabase/database.types.ts";

export type Role = "student" | "department" | "admin";

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") {
    console.error(`Missing ${name}.`);
    process.exit(1);
  }
  return value;
}

export const isLocalUrl = (url: string): boolean =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(new URL(url).origin);

export function serviceClient(): SupabaseClient<Database> {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SECRET_KEY"),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}

/** Signs in through @supabase/ssr with an in-memory jar: the same cookies a browser would hold. */
export async function sessionCookie(email: string, password: string): Promise<string> {
  const jar = new Map<string, string>();
  const client = createServerClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      cookies: {
        getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
        setAll: (cookies) => {
          for (const { name, value } of cookies) jar.set(name, value);
        },
      },
    },
  );
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error !== null) throw new Error(`sign-in failed: ${error.message}`);
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

export interface TempUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  readonly cookie: string;
}

/** A confirmed fictional account with the given role, signed in. Remove it with deleteTempUsers. */
export async function createTempUser(
  label: string,
  role: Role,
  departmentCode?: string,
): Promise<TempUser> {
  const admin = serviceClient();
  const email = `${label}-${randomUUID().slice(0, 8)}@makeitright.test`;
  const password = `Tmp${randomUUID().replaceAll("-", "")}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: `Temp ${label}` },
  });
  if (error !== null) throw new Error(`createUser failed: ${error.message}`);
  if (role !== "student") {
    let departmentId: string | null = null;
    if (departmentCode !== undefined) {
      const { data: department } = await admin
        .from("departments")
        .select("id")
        .eq("code", departmentCode)
        .single();
      departmentId = department?.id ?? null;
    }
    const { error: roleError } = await admin
      .from("profiles")
      .update({ role, department_id: departmentId })
      .eq("id", data.user.id);
    if (roleError !== null) throw new Error(`role assignment failed: ${roleError.message}`);
  }
  return { id: data.user.id, email, password, cookie: await sessionCookie(email, password) };
}

export async function deleteTempUsers(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const admin = serviceClient();
  await admin
    .from("complaints")
    .delete()
    .in("created_by", [...ids]);
  await Promise.all(ids.map((id) => admin.auth.admin.deleteUser(id)));
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] ?? 0
  );
}
