/**
 * Department workflow through the real Data API (master plan P3.01-P3.09; Gate P3: the full
 * lifecycle works without any AI provider, with correct permissions and history).
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TRANSITION_RULES } from "@/features/complaints/workflow";

import {
  adminClient,
  createTestUser,
  deleteUsers,
  departmentId,
  type TestUser,
} from "./support/supabase";

type Client = TestUser["client"];

const created: string[] = [];
let student: TestUser;
let otherStudent: TestUser;
let electrician: TestUser;
let secondElectrician: TestUser;
let plumber: TestUser;
let admin: TestUser;
let electrical: string;
let plumbing: string;

beforeAll(async () => {
  [student, otherStudent, electrician, secondElectrician, plumber, admin] = await Promise.all([
    createTestUser("student"),
    createTestUser("student"),
    createTestUser("department", "electrical"),
    createTestUser("department", "electrical"),
    createTestUser("department", "plumbing"),
    createTestUser("admin"),
  ]);
  created.push(
    student.id,
    otherStudent.id,
    electrician.id,
    secondElectrician.id,
    plumber.id,
    admin.id,
  );
  [electrical, plumbing] = await Promise.all([
    departmentId("electrical"),
    departmentId("plumbing"),
  ]);
});

afterAll(async () => {
  await deleteUsers(created);
});

async function newTicket(owner: Client, title = "Workflow integration ticket"): Promise<string> {
  const { data, error } = await owner
    .rpc("create_ticket", {
      p_title: title,
      p_description: "A ticket used by the workflow integration tests.",
      p_building: "Block W",
      p_room: "",
      p_idempotency_key: randomUUID(),
    })
    .single();
  if (error !== null) throw new Error(error.message);
  return data.id;
}

async function version(ticketId: string): Promise<number> {
  const { data } = await adminClient()
    .from("complaints")
    .select("version")
    .eq("id", ticketId)
    .single();
  return data?.version ?? -1;
}

function transition(
  client: Client,
  ticketId: string,
  target: string,
  expectedVersion: number,
  note?: string,
) {
  return client
    .rpc("transition_ticket", {
      p_ticket_id: ticketId,
      p_target: target as "in_progress",
      p_expected_version: expectedVersion,
      ...(note === undefined ? {} : { p_note: note }),
    })
    .single();
}

function assignTo(
  departmentIdValue: string,
  ticketId: string,
  expectedVersion: number,
  client: Client = admin.client,
) {
  return client
    .rpc("assign_ticket", {
      p_ticket_id: ticketId,
      p_department_id: departmentIdValue,
      p_category: "electrical",
      p_priority: "high",
      p_expected_version: expectedVersion,
    })
    .single();
}

describe("the TypeScript rules and the database agree (P3.01 drift guard)", () => {
  it("returns exactly the transition table that drives the UI", async () => {
    const { data, error } = await student.client.rpc("ticket_transition_rules");
    expect(error).toBeNull();
    const database = (data ?? [])
      .map((rule) => `${rule.from_state}>${rule.to_state}:${rule.actor_role}`)
      .sort();
    const typescript = TRANSITION_RULES.map(
      (rule) => `${rule.from}>${rule.to}:${rule.role}`,
    ).sort();
    expect(database).toEqual(typescript);
  });
});

describe("Gate P3: full lifecycle with AI disabled", () => {
  it("submit → assign → acknowledge → work → resolve → reopen → work → resolve → close", async () => {
    const ticket = await newTicket(student.client);

    expect((await assignTo(electrical, ticket, 1)).error).toBeNull();
    expect(
      (
        await electrician.client
          .rpc("acknowledge_ticket", { p_ticket_id: ticket, p_expected_version: 2 })
          .single()
      ).error,
    ).toBeNull();
    expect((await transition(electrician.client, ticket, "in_progress", 3)).error).toBeNull();
    expect(
      (
        await electrician.client.rpc("add_ticket_note", {
          p_ticket_id: ticket,
          p_note: "Ordered a replacement fan.",
        })
      ).error,
    ).toBeNull();
    expect(
      (await transition(electrician.client, ticket, "resolved", 4, "Fan replaced.")).error,
    ).toBeNull();
    expect(
      (await transition(student.client, ticket, "reopened", 5, "Still clicking.")).error,
    ).toBeNull();
    expect((await transition(secondElectrician.client, ticket, "in_progress", 6)).error).toBeNull();
    expect(
      (await transition(secondElectrician.client, ticket, "resolved", 7, "Bearing replaced."))
        .error,
    ).toBeNull();
    const closed = await transition(student.client, ticket, "closed", 8);
    expect(closed.error).toBeNull();
    expect(closed.data).toMatchObject({ status: "closed", version: 9 });

    const { data: events } = await student.client
      .from("ticket_events")
      .select("event_type, actor_role, new_status, note")
      .eq("complaint_id", ticket)
      .order("id");
    expect(
      events?.map(
        (event) => `${event.event_type}:${event.actor_role ?? "-"}:${event.new_status ?? "-"}`,
      ),
    ).toEqual([
      "created:student:submitted",
      "assigned:admin:assigned",
      "acknowledged:department:assigned",
      "status_changed:department:in_progress",
      "note_added:department:in_progress",
      "status_changed:department:resolved",
      "status_changed:student:reopened",
      "status_changed:department:in_progress",
      "status_changed:department:resolved",
      "status_changed:student:closed",
    ]);
    expect(events?.find((event) => event.event_type === "note_added")?.note).toBe(
      "Ordered a replacement fan.",
    );
  });
});

describe("optimistic concurrency (BR-07, P3.08)", () => {
  it("two staff acting on the same version at the same moment: one wins, one gets STALE_VERSION", async () => {
    const ticket = await newTicket(student.client, "Concurrency ticket");
    await assignTo(electrical, ticket, 1);
    const current = await version(ticket);

    const [first, second] = await Promise.all([
      transition(electrician.client, ticket, "in_progress", current),
      transition(secondElectrician.client, ticket, "in_progress", current),
    ]);

    const outcomes = [first, second].map((result) => result.error?.code ?? "ok").sort();
    expect(outcomes).toEqual(["MR412", "ok"]);
    expect(await version(ticket)).toBe(current + 1);

    const { count } = await adminClient()
      .from("ticket_events")
      .select("id", { count: "exact", head: true })
      .eq("complaint_id", ticket)
      .eq("event_type", "status_changed");
    expect(count).toBe(1);
  });

  it("a stale admin reassignment does not overwrite newer work", async () => {
    const ticket = await newTicket(student.client, "Stale reassignment ticket");
    await assignTo(electrical, ticket, 1);
    await transition(electrician.client, ticket, "in_progress", 2);

    const stale = await assignTo(plumbing, ticket, 2);
    expect(stale.error?.code).toBe("MR412");

    const { data } = await adminClient()
      .from("complaints")
      .select("status, assigned_department_id")
      .eq("id", ticket)
      .single();
    expect(data).toEqual({ status: "in_progress", assigned_department_id: electrical });
  });
});

describe("permissions across roles (BR-02, BR-03, P3.09)", () => {
  let ticket: string;

  beforeAll(async () => {
    ticket = await newTicket(student.client, "Permission probe ticket");
    await assignTo(electrical, ticket, 1);
  });

  it("another department cannot see or act on the ticket", async () => {
    const read = await plumber.client.from("complaints").select("id").eq("id", ticket);
    expect(read.data).toEqual([]);
    const act = await transition(plumber.client, ticket, "in_progress", 2);
    expect(act.error?.code).toBe("MR404");
  });

  it("the reporter cannot do the department's work", async () => {
    const result = await transition(student.client, ticket, "in_progress", 2);
    expect(result.error?.code).toBe("MR403");
  });

  it("another student cannot touch it at all", async () => {
    const result = await transition(otherStudent.client, ticket, "in_progress", 2);
    expect(result.error?.code).toBe("MR404");
  });

  it("department staff cannot assign or reassign", async () => {
    const result = await assignTo(plumbing, ticket, 2, electrician.client);
    expect(result.error?.code).toBe("MR403");
  });

  it("nobody can skip the work step", async () => {
    const result = await transition(electrician.client, ticket, "resolved", 2, "Skipping ahead.");
    expect(result.error?.code).toBe("MR422");
  });

  it("direct table writes remain impossible for staff", async () => {
    const update = await electrician.client
      .from("complaints")
      .update({ status: "resolved" })
      .eq("id", ticket);
    expect(update.error?.code).toBe("42501");
  });

  it("routing rules are readable by admins only", async () => {
    const asAdmin = await admin.client.from("routing_rules").select("category");
    expect(asAdmin.data?.length).toBe(6);
    const asStudent = await student.client.from("routing_rules").select("category");
    expect(asStudent.data).toEqual([]);
  });

  it("the ticket is unchanged after every refused attempt", async () => {
    expect(await version(ticket)).toBe(2);
  });
});
