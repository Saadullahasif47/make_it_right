/**
 * Complaint persistence through the real Data API (master plan P2.07, P2.08, P2.09; Gate P2).
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SYNTHETIC_COMPLAINTS } from "../fixtures/synthetic-complaints";

import {
  adminClient,
  anonClient,
  createTestUser,
  deleteUsers,
  type TestUser,
} from "./support/supabase";

type Client = TestUser["client"];

function createArgs(
  complaint: { title: string; description: string; building: string; room?: string },
  key: string = randomUUID(),
) {
  return {
    p_title: complaint.title,
    p_description: complaint.description,
    p_building: complaint.building,
    p_room: complaint.room ?? "",
    p_idempotency_key: key,
  };
}

async function create(client: Client, complaint: Parameters<typeof createArgs>[0], key?: string) {
  return client.rpc("create_ticket", createArgs(complaint, key)).single();
}

const created: string[] = [];
let studentA: TestUser;
let studentB: TestUser;
let staff: TestUser;
let admin: TestUser;

beforeAll(async () => {
  [studentA, studentB, staff, admin] = await Promise.all([
    createTestUser("student"),
    createTestUser("student"),
    createTestUser("department", "electrical"),
    createTestUser("admin"),
  ]);
  created.push(studentA.id, studentB.id, staff.id, admin.id);
});

afterAll(async () => {
  await deleteUsers(created);
});

describe("Gate P2: twenty synthetic complaints save correctly", () => {
  it("persists every field, one CREATED event each, and unique increasing references", async () => {
    const reporter = await createTestUser("student");
    created.push(reporter.id);

    const references: number[] = [];
    for (const complaint of SYNTHETIC_COMPLAINTS) {
      const { data, error } = await create(reporter.client, complaint);
      expect(error).toBeNull();
      expect(data?.created).toBe(true);
      references.push(data?.reference_no ?? -1);
    }

    expect(new Set(references).size).toBe(20);
    expect([...references].sort((a, b) => a - b)).toEqual(references);

    const { data: rows } = await reporter.client
      .from("complaints")
      .select("title, description, building, room, status, category, priority, version, created_by")
      .order("reference_no");
    expect(rows).toHaveLength(20);
    rows?.forEach((row, index) => {
      const expected = SYNTHETIC_COMPLAINTS[index];
      expect(row).toEqual({
        title: expected?.title,
        description: expected?.description,
        building: expected?.building,
        room: expected?.room ?? null,
        status: "submitted",
        category: "unclassified",
        priority: "unassessed",
        version: 1,
        created_by: reporter.id,
      });
    });

    const { count } = await reporter.client
      .from("ticket_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "created");
    expect(count).toBe(20);
  });
});

describe("idempotency (BR-08, P2.07)", () => {
  const complaint = SYNTHETIC_COMPLAINTS[0];
  if (complaint === undefined) throw new Error("fixture missing");

  it("ten simultaneous submissions with one key create exactly one ticket", async () => {
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => create(studentA.client, complaint, key)),
    );

    for (const result of results) {
      expect(result.error).toBeNull();
    }
    const ids = new Set(results.map((result) => result.data?.id));
    expect(ids.size).toBe(1);
    expect(results.filter((result) => result.data?.created === true)).toHaveLength(1);

    const [id] = [...ids];
    const { count: events } = await adminClient()
      .from("ticket_events")
      .select("id", { count: "exact", head: true })
      .eq("complaint_id", id ?? "");
    expect(events).toBe(1);
  });

  it("refuses to reuse a key for different content", async () => {
    const key = randomUUID();
    await create(studentA.client, complaint, key);
    const { error } = await create(
      studentA.client,
      { ...complaint, title: "Something else entirely" },
      key,
    );
    expect(error?.code).toBe("MR409");
  });

  it("twenty simultaneous distinct submissions all succeed with unique references", async () => {
    const burst = await createTestUser("student");
    created.push(burst.id);

    const results = await Promise.all(
      SYNTHETIC_COMPLAINTS.map((item) => create(burst.client, item)),
    );
    expect(results.every((result) => result.error === null)).toBe(true);
    expect(new Set(results.map((result) => result.data?.reference_no)).size).toBe(20);

    const { error } = await create(burst.client, complaint);
    expect(error?.code).toBe("MR429");
  });

  it("the rate limit holds under concurrency: 30 simultaneous submissions, exactly 20 accepted", async () => {
    const flood = await createTestUser("student");
    created.push(flood.id);

    const results = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        create(flood.client, {
          title: `Concurrent report ${index + 1}`,
          description: `Concurrent submission number ${index + 1} in one burst.`,
          building: "Block F",
        }),
      ),
    );

    expect(results.filter((result) => result.error === null)).toHaveLength(20);
    expect(results.filter((result) => result.error?.code === "MR429")).toHaveLength(10);

    const { count } = await adminClient()
      .from("complaints")
      .select("id", { count: "exact", head: true })
      .eq("created_by", flood.id);
    expect(count).toBe(20);
  });
});

describe("read isolation (BR-10, P2.08)", () => {
  let ticketOfA: string;

  beforeAll(async () => {
    const { data } = await create(studentA.client, {
      title: "Private report of student A",
      description: "Only student A and staff should ever see this report.",
      building: "Block A",
    });
    ticketOfA = data?.id ?? "";
  });

  it("student B cannot fetch student A's ticket by id", async () => {
    const { data } = await studentB.client.from("complaints").select("id").eq("id", ticketOfA);
    expect(data).toEqual([]);
  });

  it("student B's list contains none of student A's tickets", async () => {
    const { data } = await studentB.client.rpc("list_complaints", { p_limit: 50 });
    expect(data?.some((row) => row.created_by !== studentB.id)).toBe(false);
  });

  it("student B cannot read student A's timeline", async () => {
    const { data } = await studentB.client
      .from("ticket_events")
      .select("id")
      .eq("complaint_id", ticketOfA);
    expect(data).toEqual([]);
  });

  it("department staff see nothing that is not assigned to them", async () => {
    const { data } = await staff.client.from("complaints").select("id").eq("id", ticketOfA);
    expect(data).toEqual([]);
  });

  it("an admin can see it", async () => {
    const { data } = await admin.client.from("complaints").select("id").eq("id", ticketOfA);
    expect(data).toEqual([{ id: ticketOfA }]);
  });

  it("anonymous callers can neither read nor create", async () => {
    const read = await anonClient().from("complaints").select("id");
    expect(read.error?.code).toBe("42501");
    const write = await create(anonClient(), {
      title: "Anonymous report",
      description: "Created without any account at all.",
      building: "Block A",
    });
    expect(write.error).not.toBeNull();
  });
});

describe("no direct writes (P2.09)", () => {
  let ownTicket: string;

  beforeAll(async () => {
    const { data } = await create(studentB.client, {
      title: "Ticket used for write probes",
      description: "Probing every direct write path against this ticket.",
      building: "Block B",
    });
    ownTicket = data?.id ?? "";
  });

  it("cannot insert a complaint directly, even for themselves", async () => {
    const { error } = await studentB.client.from("complaints").insert({
      created_by: studentB.id,
      title: "Direct insert",
      description: "Trying to bypass the create function.",
      building: "Block B",
    });
    expect(error?.code).toBe("42501");
  });

  it.each([
    ["status", { status: "closed" as const }],
    ["category", { category: "electrical" as const }],
    ["priority", { priority: "high" as const }],
    ["owner", { created_by: "00000000-0000-0000-0000-000000000000" }],
    ["version", { version: 99 }],
  ])("cannot update the %s of their own ticket", async (_label, patch) => {
    const { error } = await studentB.client.from("complaints").update(patch).eq("id", ownTicket);
    expect(error?.code).toBe("42501");
  });

  it("cannot delete their ticket or forge timeline events", async () => {
    const remove = await studentB.client.from("complaints").delete().eq("id", ownTicket);
    expect(remove.error?.code).toBe("42501");

    const forge = await studentB.client
      .from("ticket_events")
      .insert({ complaint_id: ownTicket, event_type: "created", actor_kind: "system" });
    expect(forge.error?.code).toBe("42501");
  });

  it("cannot read idempotency keys", async () => {
    const { error } = await studentB.client.from("submission_keys").select("*");
    expect(error?.code).toBe("42501");
  });

  it("cannot smuggle extra arguments such as a status into create_ticket", async () => {
    const before = await adminClient()
      .from("complaints")
      .select("id", { count: "exact", head: true })
      .eq("created_by", studentB.id);

    const { error } = await studentB.client.rpc(
      "create_ticket",
      // Deliberately calls a signature that does not exist.
      {
        ...createArgs({
          title: "Smuggled status",
          description: "Trying to set status at creation.",
          building: "B",
        }),
        p_status: "resolved",
      } as never,
    );
    expect(error).not.toBeNull();

    const after = await adminClient()
      .from("complaints")
      .select("id", { count: "exact", head: true })
      .eq("created_by", studentB.id);
    expect(after.count).toBe(before.count);
  });

  it("the ticket is untouched after every attempt", async () => {
    const { data } = await adminClient()
      .from("complaints")
      .select("status, category, priority, version, created_by")
      .eq("id", ownTicket)
      .single();
    expect(data).toEqual({
      status: "submitted",
      category: "unclassified",
      priority: "unassessed",
      version: 1,
      created_by: studentB.id,
    });
  });
});
