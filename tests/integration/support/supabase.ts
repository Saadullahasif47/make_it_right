import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type Role = Database["public"]["Enums"]["app_role"];

export interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  /** Signed in with the publishable key: exactly what a browser could do. */
  readonly client: SupabaseClient<Database>;
}

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run \`pnpm db:start\` and \`pnpm db:env\` first.`);
  }
  return value;
}

export const supabaseUrl = (): string => env("NEXT_PUBLIC_SUPABASE_URL");
const publishableKey = (): string => env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } } as const;

export function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl(), publishableKey(), clientOptions);
}

export function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl(), env("SUPABASE_SECRET_KEY"), clientOptions);
}

export function uniqueEmail(label: string): string {
  return `it-${label}-${randomUUID().slice(0, 8)}@makeitright.test`;
}

export async function departmentId(code: string): Promise<string> {
  const { data, error } = await adminClient()
    .from("departments")
    .select("id")
    .eq("code", code)
    .single();
  if (error !== null) {
    throw new Error(`Department ${code} missing; was the seed applied?`);
  }
  return data.id;
}

/** Creates a confirmed user, assigns the role through the privileged path, and signs in. */
export async function createTestUser(role: Role, departmentCode?: string): Promise<TestUser> {
  const admin = adminClient();
  const email = uniqueEmail(role);
  const password = `It${randomUUID().replaceAll("-", "")}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: `Integration ${role}` },
  });
  if (error !== null) {
    throw new Error(`createUser failed: ${error.message}`);
  }

  if (role !== "student") {
    const { error: roleError } = await admin
      .from("profiles")
      .update({
        role,
        department_id: departmentCode === undefined ? null : await departmentId(departmentCode),
      })
      .eq("id", data.user.id);
    if (roleError !== null) {
      throw new Error(`role assignment failed: ${roleError.message}`);
    }
  }

  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError !== null) {
    throw new Error(`signIn failed: ${signInError.message}`);
  }

  return { id: data.user.id, email, password, client };
}

/**
 * Removes test users. Their complaints go first: the database deliberately refuses to delete a
 * profile that still owns tickets (complaints.created_by is ON DELETE RESTRICT).
 */
export async function deleteUsers(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const admin = adminClient();
  const { error } = await admin
    .from("complaints")
    .delete()
    .in("created_by", [...ids]);
  if (error !== null) {
    throw new Error(`complaint cleanup failed: ${error.message}`);
  }
  await Promise.all(ids.map((id) => admin.auth.admin.deleteUser(id)));
}
