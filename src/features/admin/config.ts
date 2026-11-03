import "server-only";

import { z } from "zod";

import { COMPLAINT_CATEGORIES, type ComplaintCategory } from "@/features/complaints/categories";
import { complaintErrorFromDatabase } from "@/features/complaints/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";

export interface DepartmentRecord {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly isActive: boolean;
}

export interface RoutingRuleRecord {
  readonly category: ComplaintCategory;
  readonly departmentId: string;
  readonly enabled: boolean;
  readonly updatedAt: string;
}

/** What a change set, parsed from the stored jsonb so nothing downstream has to trust it. */
export type ConfigChangeDetail =
  | { readonly kind: "department"; readonly code: string; readonly isActive: boolean }
  | {
      readonly kind: "routing_rule";
      readonly category: string;
      readonly departmentId: string;
      readonly enabled: boolean;
    }
  | { readonly kind: "unknown" };

export interface ConfigChange {
  readonly id: number;
  readonly changedByName: string | null;
  readonly detail: ConfigChangeDetail;
  readonly createdAt: string;
}

const departmentAfterSchema = z.object({ is_active: z.boolean() });
const routingAfterSchema = z.object({ department_id: z.string(), enabled: z.boolean() });

function parseDetail(entity: string, key: string, after: unknown): ConfigChangeDetail {
  if (entity === "department") {
    const parsed = departmentAfterSchema.safeParse(after);
    return parsed.success
      ? { kind: "department", code: key, isActive: parsed.data.is_active }
      : { kind: "unknown" };
  }
  const parsed = routingAfterSchema.safeParse(after);
  return parsed.success
    ? {
        kind: "routing_rule",
        category: key,
        departmentId: parsed.data.department_id,
        enabled: parsed.data.enabled,
      }
    : { kind: "unknown" };
}

/** Every department, active or not (admins manage availability here). */
export async function listAllDepartments(
  client: AppSupabaseClient,
): Promise<readonly DepartmentRecord[]> {
  const { data, error } = await client
    .from("departments")
    .select("id, code, name, is_active")
    .order("name");
  if (error !== null) {
    throw complaintErrorFromDatabase(error);
  }
  return data.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: row.is_active,
  }));
}

/** Routing rules, one per category; RLS limits them to administrators. */
export async function listRoutingRuleRecords(
  client: AppSupabaseClient,
): Promise<readonly RoutingRuleRecord[]> {
  const { data, error } = await client
    .from("routing_rules")
    .select("category, department_id, enabled, updated_at")
    .order("category");
  if (error !== null) {
    throw complaintErrorFromDatabase(error);
  }
  return data.flatMap((row) =>
    row.category === "unclassified"
      ? []
      : [
          {
            category: row.category,
            departmentId: row.department_id,
            enabled: row.enabled,
            updatedAt: row.updated_at,
          },
        ],
  );
}

/** The latest configuration changes with the acting admin's display name. */
export async function listConfigChanges(
  client: AppSupabaseClient,
  limit = 10,
): Promise<readonly ConfigChange[]> {
  const { data, error } = await client
    .from("config_changes")
    .select("id, changed_by, entity, entity_key, after_value, created_at")
    .order("id", { ascending: false })
    .limit(limit);
  if (error !== null) {
    throw complaintErrorFromDatabase(error);
  }
  const actorIds = [...new Set(data.map((row) => row.changed_by))];
  const names = new Map<string, string | null>();
  if (actorIds.length > 0) {
    const profiles = await client.from("profiles").select("id, display_name").in("id", actorIds);
    for (const profile of profiles.data ?? []) {
      names.set(profile.id, profile.display_name);
    }
  }
  return data.map((row) => ({
    id: row.id,
    changedByName: names.get(row.changed_by) ?? null,
    detail: parseDetail(row.entity, row.entity_key, row.after_value),
    createdAt: row.created_at,
  }));
}

export const departmentToggleSchema = z.strictObject({
  departmentId: z.uuid("Unknown department."),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const routingRuleSchema = z.strictObject({
  category: z.enum(COMPLAINT_CATEGORIES, "Choose a category."),
  departmentId: z.uuid("Choose a department."),
  enabled: z.enum(["true", "false"]).transform((value) => value === "true"),
});

/** "Not modified": the requested setting is already in place (SQLSTATE MR304). */
const NOT_MODIFIED = "MR304";

export type ConfigResult<T> =
  { readonly changed: true; readonly value: T } | { readonly changed: false };

export async function setDepartmentActive(
  client: AppSupabaseClient,
  departmentId: string,
  active: boolean,
): Promise<ConfigResult<{ readonly isActive: boolean; readonly routesAffected: number }>> {
  const { data, error } = await client
    .rpc("admin_set_department_active", { p_department_id: departmentId, p_active: active })
    .single();
  if (error !== null) {
    if (error.code === NOT_MODIFIED) return { changed: false };
    throw complaintErrorFromDatabase(error);
  }
  return {
    changed: true,
    value: { isActive: data.is_active, routesAffected: data.routes_affected },
  };
}

export async function setRoutingRule(
  client: AppSupabaseClient,
  category: ComplaintCategory,
  departmentId: string,
  enabled: boolean,
): Promise<ConfigResult<null>> {
  const { error } = await client
    .rpc("admin_set_routing_rule", {
      p_category: category,
      p_department_id: departmentId,
      p_enabled: enabled,
    })
    .single();
  if (error !== null) {
    if (error.code === NOT_MODIFIED) return { changed: false };
    throw complaintErrorFromDatabase(error);
  }
  return { changed: true, value: null };
}
