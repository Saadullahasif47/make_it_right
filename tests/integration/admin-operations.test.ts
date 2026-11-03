/**
 * Administrator operations through the real Data API (master plan P5.01; Gate P5). pgTAP proves
 * the numbers and the rules; this proves the same guarantees hold over HTTP with real sessions.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, createTestUser, deleteUsers, type TestUser } from "./support/supabase";

const created: string[] = [];
let student: TestUser;
let staff: TestUser;
let admin: TestUser;
let departmentId: string;

beforeAll(async () => {
  [student, staff, admin] = await Promise.all([
    createTestUser("student"),
    createTestUser("department", "electrical"),
    createTestUser("admin"),
  ]);
  created.push(student.id, staff.id, admin.id);
  const { data, error } = await adminClient()
    .from("departments")
    .insert({ code: `int_ops_${Date.now()}`, name: "Integration Ops" })
    .select("id")
    .single();
  if (error !== null) throw new Error(error.message);
  departmentId = data.id;
});

afterAll(async () => {
  await deleteUsers(created);
  await adminClient().from("departments").delete().eq("id", departmentId);
});

describe("admin_metrics over the Data API", () => {
  it.each([
    ["a student", () => student],
    ["department staff", () => staff],
  ])("refuses %s with MR403", async (_label, user) => {
    const { error } = await user().client.rpc("admin_metrics", { p_window_days: 30 });
    expect(error?.code).toBe("MR403");
  });

  it("answers an administrator with the full shape", async () => {
    const { data, error } = await admin.client.rpc("admin_metrics", { p_window_days: 7 });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      window_days: 7,
      totals: expect.any(Object) as unknown,
      ai: expect.any(Object) as unknown,
    });
  });

  it("rejects an out-of-range window", async () => {
    const { error } = await admin.client.rpc("admin_metrics", { p_window_days: 365 });
    expect(error?.code).toBe("22023");
  });
});

describe("department availability over the Data API", () => {
  it("is refused to non-admins and recorded for admins", async () => {
    const refused = await staff.client
      .rpc("admin_set_department_active", { p_department_id: departmentId, p_active: false })
      .single();
    expect(refused.error?.code).toBe("MR403");

    const changed = await admin.client
      .rpc("admin_set_department_active", { p_department_id: departmentId, p_active: false })
      .single();
    expect(changed.error).toBeNull();
    expect(changed.data).toMatchObject({ is_active: false, routes_affected: 0 });

    const again = await admin.client
      .rpc("admin_set_department_active", { p_department_id: departmentId, p_active: false })
      .single();
    expect(again.error?.code).toBe("MR304");

    const { data: log } = await admin.client
      .from("config_changes")
      .select("entity, after_value")
      .eq("changed_by", admin.id);
    expect(log).toEqual([{ entity: "department", after_value: { is_active: false } }]);
  });

  it("cannot be bypassed with a direct table write", async () => {
    const { error } = await admin.client
      .from("departments")
      .update({ is_active: true })
      .eq("id", departmentId);
    expect(error?.code).toBe("42501");
    const { data } = await adminClient()
      .from("departments")
      .select("is_active")
      .eq("id", departmentId)
      .single();
    expect(data?.is_active).toBe(false);
  });

  it("keeps the change log out of reach of everyone but admins", async () => {
    const { data } = await student.client.from("config_changes").select("id");
    expect(data).toEqual([]);
  });
});
