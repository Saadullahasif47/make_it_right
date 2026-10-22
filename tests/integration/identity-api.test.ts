/**
 * Direct-client denial tests (master plan P1.07, P1.08): everything a user could try from a
 * browser console with the publishable key, against the real Auth and Data APIs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminClient,
  anonClient,
  createTestUser,
  deleteUsers,
  supabaseUrl,
  uniqueEmail,
  type TestUser,
} from "./support/supabase";

let studentA: TestUser;
let studentB: TestUser;
let staff: TestUser;
let admin: TestUser;
const createdIds: string[] = [];

beforeAll(async () => {
  [studentA, studentB, staff, admin] = await Promise.all([
    createTestUser("student"),
    createTestUser("student"),
    createTestUser("department", "electrical"),
    createTestUser("admin"),
  ]);
  createdIds.push(studentA.id, studentB.id, staff.id, admin.id);
});

afterAll(async () => {
  await deleteUsers(createdIds);
});

describe("sign-up through the Auth API", () => {
  it("always creates a student, whatever role the client asks for", async () => {
    const email = uniqueEmail("signup");
    const { data, error } = await anonClient().auth.signUp({
      email,
      password: "campus2026signup",
      options: {
        data: {
          display_name: "Signup Probe",
          role: "admin",
          department_id: "00000000-0000-0000-0000-000000000000",
        },
      },
    });
    expect(error).toBeNull();
    const userId = data.user?.id;
    expect(userId).toBeDefined();
    if (userId === undefined) return;
    createdIds.push(userId);

    const { data: profile } = await adminClient()
      .from("profiles")
      .select("role, department_id, display_name")
      .eq("id", userId)
      .single();
    expect(profile).toEqual({ role: "student", department_id: null, display_name: "Signup Probe" });
  });

  it("does not sign in an unconfirmed account", async () => {
    const email = uniqueEmail("unconfirmed");
    const client = anonClient();
    const { data } = await client.auth.signUp({ email, password: "campus2026unconf" });
    if (data.user !== null) createdIds.push(data.user.id);

    const { error } = await client.auth.signInWithPassword({ email, password: "campus2026unconf" });
    expect(error?.code).toBe("email_not_confirmed");
  });

  it("enforces the password policy on the server, not only in the form", async () => {
    const { error } = await anonClient().auth.signUp({
      email: uniqueEmail("weak"),
      password: "short1",
    });
    expect(error?.code).toBe("weak_password");
  });
});

describe("anonymous Data API access", () => {
  it("cannot read profiles", async () => {
    const { data, error } = await anonClient().from("profiles").select("id");
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("cannot read departments", async () => {
    const { error } = await anonClient().from("departments").select("id");
    expect(error?.code).toBe("42501");
  });

  it("cannot reach the private schema's helpers", async () => {
    const response = await fetch(`${supabaseUrl()}/rest/v1/rpc/current_app_role`, {
      method: "POST",
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(response.ok).toBe(false);
  });

  it("cannot use the Auth admin API with the publishable key", async () => {
    const { error } = await anonClient().auth.admin.listUsers();
    expect(error).not.toBeNull();
  });
});

describe("a signed-in student", () => {
  it("sees only their own profile", async () => {
    const { data, error } = await studentA.client.from("profiles").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([{ id: studentA.id }]);
  });

  it("cannot look up another student by id", async () => {
    const { data } = await studentA.client.from("profiles").select("id").eq("id", studentB.id);
    expect(data).toEqual([]);
  });

  it("can change their own display name", async () => {
    const { error } = await studentA.client
      .from("profiles")
      .update({ display_name: "Renamed Student" })
      .eq("id", studentA.id);
    expect(error).toBeNull();
  });

  it.each([
    ["role", { role: "admin" as const }],
    ["department", { department_id: "00000000-0000-0000-0000-000000000000" }],
    ["role and department together", { role: "department" as const, department_id: null }],
  ])("cannot change their %s", async (_label, patch) => {
    const { error } = await studentA.client.from("profiles").update(patch).eq("id", studentA.id);
    expect(error?.code).toBe("42501");

    const { data } = await adminClient()
      .from("profiles")
      .select("role")
      .eq("id", studentA.id)
      .single();
    expect(data?.role).toBe("student");
  });

  it("cannot rename another student", async () => {
    await studentA.client
      .from("profiles")
      .update({ display_name: "hijacked" })
      .eq("id", studentB.id);

    const { data } = await adminClient()
      .from("profiles")
      .select("display_name")
      .eq("id", studentB.id)
      .single();
    expect(data?.display_name).toBe("Integration student");
  });

  it("cannot insert or delete profiles", async () => {
    const insert = await studentA.client
      .from("profiles")
      .insert({ id: studentA.id, role: "admin" });
    expect(insert.error?.code).toBe("42501");

    const remove = await studentA.client.from("profiles").delete().eq("id", studentA.id);
    expect(remove.error?.code).toBe("42501");
  });

  it("can read departments but not change them", async () => {
    const read = await studentA.client.from("departments").select("code");
    expect(read.error).toBeNull();
    expect(read.data?.length).toBeGreaterThanOrEqual(6);

    const insert = await studentA.client
      .from("departments")
      .insert({ code: "rogue", name: "Rogue" });
    expect(insert.error?.code).toBe("42501");

    const update = await studentA.client
      .from("departments")
      .update({ is_active: false })
      .eq("code", "electrical");
    expect(update.error?.code).toBe("42501");
  });

  it("cannot gain authority by editing their own auth metadata", async () => {
    const { error } = await studentA.client.auth.updateUser({ data: { role: "admin" } });
    expect(error).toBeNull(); // user metadata is theirs to edit, but it confers nothing:

    const { data } = await studentA.client.from("profiles").select("id");
    expect(data).toEqual([{ id: studentA.id }]);
  });
});

describe("department staff", () => {
  it("see only their own profile", async () => {
    const { data } = await staff.client.from("profiles").select("id");
    expect(data).toEqual([{ id: staff.id }]);
  });

  it("cannot move themselves to another department", async () => {
    const { error } = await staff.client
      .from("profiles")
      .update({ department_id: "00000000-0000-0000-0000-000000000000" })
      .eq("id", staff.id);
    expect(error?.code).toBe("42501");
  });
});

describe("an administrator", () => {
  it("can read every profile", async () => {
    const { data } = await admin.client
      .from("profiles")
      .select("id")
      .in("id", [studentA.id, studentB.id, staff.id, admin.id]);
    expect(data?.map((row) => row.id).sort()).toEqual(
      [studentA.id, studentB.id, staff.id, admin.id].sort(),
    );
  });

  it("still cannot change roles with a direct update", async () => {
    const { error } = await admin.client
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", studentB.id);
    expect(error?.code).toBe("42501");
  });
});
