/**
 * Maintenance foundation through the real Data API (Advanced Features plan v2 A0.03-A0.05).
 * Every new table is read-only for signed-in users and scoped by role; a ticket's case follows
 * the audited ticket workflow, including under concurrent requests.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminClient,
  anonClient,
  createTestUser,
  deleteUsers,
  departmentId,
  type TestUser,
} from "./support/supabase";

const NEW_TABLES = [
  "maintenance_locations",
  "asset_registry",
  "maintenance_cases",
  "case_reports",
  "case_events",
  "evidence_attachments",
  "ai_jobs",
] as const;

const created: string[] = [];
let student: TestUser;
let otherStudent: TestUser;
let electrician: TestUser;
let plumber: TestUser;
let admin: TestUser;
let electrical: string;

beforeAll(async () => {
  [student, otherStudent, electrician, plumber, admin] = await Promise.all([
    createTestUser("student"),
    createTestUser("student"),
    createTestUser("department", "electrical"),
    createTestUser("department", "plumbing"),
    createTestUser("admin"),
  ]);
  created.push(student.id, otherStudent.id, electrician.id, plumber.id, admin.id);
  electrical = await departmentId("electrical");
});

afterAll(async () => {
  await deleteUsers(created);
});

async function newTicket(building = "ENG", room = "LAB-204"): Promise<string> {
  const { data, error } = await student.client
    .rpc("create_ticket", {
      p_title: "Foundation integration ticket",
      p_description: "A ticket used by the maintenance foundation integration tests.",
      p_building: building,
      p_room: room,
      p_idempotency_key: randomUUID(),
    })
    .single();
  if (error !== null) throw new Error(error.message);
  return data.id;
}

interface CaseRow {
  readonly id: string;
  readonly status: string;
  readonly version: number;
  readonly assigned_department_id: string | null;
  readonly location_id: string | null;
}

/** The ticket's case, read with the secret key (bypasses RLS). */
async function caseOf(ticketId: string): Promise<CaseRow> {
  const { data, error } = await adminClient()
    .from("case_reports")
    .select("maintenance_cases (id, status, version, assigned_department_id, location_id)")
    .eq("complaint_id", ticketId)
    .single();
  if (error !== null) {
    throw new Error(`no case for ${ticketId}: ${error.message}`);
  }
  return data.maintenance_cases;
}

async function ticketVersion(ticketId: string): Promise<number> {
  const { data, error } = await adminClient()
    .from("complaints")
    .select("version")
    .eq("id", ticketId)
    .single();
  if (error !== null) throw new Error(error.message);
  return data.version;
}

async function assignToElectrical(ticketId: string): Promise<void> {
  const { error } = await admin.client.rpc("assign_ticket", {
    p_ticket_id: ticketId,
    p_department_id: electrical,
    p_category: "electrical",
    p_priority: "medium",
    p_expected_version: await ticketVersion(ticketId),
  });
  if (error !== null) throw new Error(error.message);
}

describe("new tables are closed to the browser", () => {
  it.each(NEW_TABLES)("anonymous visitors cannot read %s", async (table) => {
    const { data, error } = await anonClient().from(table).select("*").limit(1);
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("signed-in users can read campus locations and assets", async () => {
    const [locations, assets] = await Promise.all([
      student.client.from("maintenance_locations").select("id", { count: "exact", head: true }),
      student.client.from("asset_registry").select("id", { count: "exact", head: true }),
    ]);
    expect(locations.count).toBeGreaterThanOrEqual(36);
    expect(assets.count).toBeGreaterThanOrEqual(12);
  });

  it("nobody can insert, change or delete rows directly, admins included", async () => {
    const ticketId = await newTicket();
    const { id: caseId } = await caseOf(ticketId);

    for (const user of [student, electrician, admin]) {
      const update = await user.client
        .from("maintenance_cases")
        .update({ status: "closed" })
        .eq("id", caseId);
      expect(update.error?.code).toBe("42501");

      const link = await user.client
        .from("case_reports")
        .insert({ complaint_id: ticketId, case_id: caseId });
      expect(link.error?.code).toBe("42501");

      const job = await user.client.from("ai_jobs").insert({
        job_type: "visual_analysis",
        target_id: ticketId,
        dedupe_key: `forged-${randomUUID()}`,
      });
      expect(job.error?.code).toBe("42501");

      const history = await user.client.from("case_events").delete().eq("case_id", caseId);
      expect(history.error?.code).toBe("42501");
    }

    expect((await caseOf(ticketId)).status).toBe("open");
  });
});

describe("a report opens a case that follows its ticket", () => {
  it("opens one located case per new report, and UNKNOWN when the room is not on the map", async () => {
    const [located, unknown] = await Promise.all([
      newTicket(" eng ", "lab-204"),
      newTicket("Annex", "7"),
    ]);
    const { data: room } = await adminClient()
      .from("maintenance_locations")
      .select("id")
      .eq("building_code", "ENG")
      .eq("room_code", "LAB-204")
      .single();

    expect((await caseOf(located)).location_id).toBe(room?.id);
    expect((await caseOf(unknown)).location_id).toBeNull();
  });

  it("shows the case to the assigned department and admins, never to students", async () => {
    const ticketId = await newTicket();
    await assignToElectrical(ticketId);
    const { id: caseId, status, assigned_department_id } = await caseOf(ticketId);
    expect(status).toBe("assigned");
    expect(assigned_department_id).toBe(electrical);

    const visible = async (user: TestUser): Promise<number> => {
      const { data, error } = await user.client
        .from("maintenance_cases")
        .select("id")
        .eq("id", caseId);
      if (error !== null) throw new Error(error.message);
      return data.length;
    };
    expect(await visible(electrician)).toBe(1);
    expect(await visible(admin)).toBe(1);
    expect(await visible(plumber)).toBe(0);
    expect(await visible(student)).toBe(0);
    expect(await visible(otherStudent)).toBe(0);

    const { data: events } = await electrician.client
      .from("case_events")
      .select("event_type, new_status")
      .eq("case_id", caseId)
      .order("id");
    expect(events).toEqual([
      { event_type: "opened", new_status: "open" },
      { event_type: "assigned", new_status: "assigned" },
    ]);
  });

  it("records exactly one case change when two people race on the same ticket version", async () => {
    const ticketId = await newTicket();
    await assignToElectrical(ticketId);
    const version = await ticketVersion(ticketId);
    const caseBefore = await caseOf(ticketId);

    const attempts = await Promise.all(
      [electrician, admin].map((user) =>
        user.client.rpc("transition_ticket", {
          p_ticket_id: ticketId,
          p_target: "in_progress",
          p_expected_version: version,
        }),
      ),
    );
    expect(attempts.filter((attempt) => attempt.error === null)).toHaveLength(1);
    expect(attempts.find((attempt) => attempt.error !== null)?.error.code).toBe("MR412");

    const caseAfter = await caseOf(ticketId);
    expect(caseAfter.status).toBe("in_progress");
    expect(caseAfter.version).toBe(caseBefore.version + 1);

    const { count } = await adminClient()
      .from("case_events")
      .select("id", { count: "exact", head: true })
      .eq("case_id", caseAfter.id)
      .eq("new_status", "in_progress");
    expect(count).toBe(1);
  });

  it("removes the case with its report when maintenance cleanup deletes the ticket", async () => {
    const ticketId = await newTicket();
    const { id: caseId } = await caseOf(ticketId);

    const { error } = await adminClient().from("complaints").delete().eq("id", ticketId);
    expect(error).toBeNull();

    const { count } = await adminClient()
      .from("maintenance_cases")
      .select("id", { count: "exact", head: true })
      .eq("id", caseId);
    expect(count).toBe(0);
  });
});

describe("synthetic campus history", () => {
  it("holds the 60 labelled demo cases, visible to admins only", async () => {
    const [asAdmin, asStudent] = await Promise.all([
      admin.client
        .from("maintenance_cases")
        .select("id", { count: "exact", head: true })
        .eq("is_synthetic", true),
      student.client
        .from("maintenance_cases")
        .select("id", { count: "exact", head: true })
        .eq("is_synthetic", true),
    ]);
    expect(asAdmin.count).toBe(60);
    expect(asStudent.count).toBe(0);
  });
});
