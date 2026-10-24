import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/features/auth/session";
import { MAX_BODY_BYTES, createComplaintsApi, isCrossSiteRequest } from "@/features/complaints/api";
import { ComplaintError } from "@/features/complaints/errors";
import * as repository from "@/features/complaints/repository";
import { createLogger } from "@/lib/logging/logger";
import type { AppSupabaseClient } from "@/lib/supabase/server";

vi.mock("@/features/complaints/repository", () => ({
  createTicket: vi.fn(),
  listComplaints: vi.fn(),
  getComplaint: vi.fn(),
  transitionTicket: vi.fn(),
  acknowledgeTicket: vi.fn(),
  addTicketNote: vi.fn(),
  assignTicket: vi.fn(),
}));

const ORIGIN = "https://makeitright.test";
const KEY = "3f0c1a52-2c41-4a8e-9a55-1f0d7c2b9e10";
const VALID = {
  title: "Ceiling fan not working",
  description: "The ceiling fan in room 214 stopped spinning.",
  building: "Block C",
  room: "214",
};

const student: SessionUser = {
  id: "a0000000-0000-4000-8000-00000000000a",
  email: "student@makeitright.test",
  displayName: "Student",
  role: "student",
  departmentId: null,
};

const logLines: string[] = [];
// The repository is mocked, so the client is never touched; an empty object stands in for it.
const fakeClient = {} as AppSupabaseClient;
let actor: SessionUser | null = student;

const api = createComplaintsApi({
  getActor: () => Promise.resolve(actor),
  getClient: () => Promise.resolve(fakeClient),
  getLogger: () => createLogger({ level: "debug", sink: (_level, line) => logLines.push(line) }),
});

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/complaints`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": KEY, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function errorOf(response: Response) {
  return ((await response.json()) as { error: { code: string; fields?: Record<string, string> } })
    .error;
}

beforeEach(() => {
  actor = student;
  logLines.length = 0;
  vi.mocked(repository.createTicket).mockReset();
  vi.mocked(repository.listComplaints).mockReset();
  vi.mocked(repository.getComplaint).mockReset();
  vi.mocked(repository.transitionTicket).mockReset();
  vi.mocked(repository.assignTicket).mockReset();
});

describe("cross-site protection", () => {
  it.each([
    [{ origin: "https://evil.example" }, true],
    [{ "sec-fetch-site": "cross-site" }, true],
    [{ origin: ORIGIN, "sec-fetch-site": "same-origin" }, false],
    [{}, false],
  ])("%j is cross-site: %s", (headers, expected) => {
    expect(
      isCrossSiteRequest(new Request(`${ORIGIN}/api/complaints`, { method: "POST", headers })),
    ).toBe(expected);
  });
});

describe("POST /api/complaints", () => {
  it("creates a ticket: 201 with its reference", async () => {
    vi.mocked(repository.createTicket).mockResolvedValue({
      id: "c0000000-0000-4000-8000-000000000001",
      reference: "MIR-1001",
      status: "submitted",
      created: true,
    });

    const response = await api.create(post(VALID));

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      id: "c0000000-0000-4000-8000-000000000001",
      reference: "MIR-1001",
      status: "submitted",
      created: true,
    });
    expect(vi.mocked(repository.createTicket)).toHaveBeenCalledWith(fakeClient, VALID, KEY);
  });

  it("answers 200 (not 201) when the key was already used: the original ticket", async () => {
    vi.mocked(repository.createTicket).mockResolvedValue({
      id: "c0000000-0000-4000-8000-000000000001",
      reference: "MIR-1001",
      status: "submitted",
      created: false,
    });
    expect((await api.create(post(VALID))).status).toBe(200);
  });

  it("refuses cross-site requests before doing anything else", async () => {
    actor = null;
    const response = await api.create(post(VALID, { origin: "https://evil.example" }));
    expect(response.status).toBe(403);
    expect(vi.mocked(repository.createTicket)).not.toHaveBeenCalled();
  });

  it("requires JSON (blocks plain HTML form posts)", async () => {
    const response = await api.create(
      post(VALID, { "content-type": "application/x-www-form-urlencoded" }),
    );
    expect(response.status).toBe(415);
  });

  it("rejects an oversized body by declared length and by actual size", async () => {
    expect(
      (await api.create(post(VALID, { "content-length": String(MAX_BODY_BYTES + 1) }))).status,
    ).toBe(413);
    expect(
      (await api.create(post({ ...VALID, description: "x".repeat(MAX_BODY_BYTES) }))).status,
    ).toBe(413);
  });

  it("requires a signed-in user", async () => {
    actor = null;
    const response = await api.create(post(VALID));
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe("UNAUTHENTICATED");
  });

  it("is for students only (plan §11)", async () => {
    actor = {
      ...student,
      role: "department",
      departmentId: "d0000000-0000-4000-8000-000000000001",
    };
    expect((await api.create(post(VALID))).status).toBe(403);
  });

  it("reports malformed JSON as a validation error", async () => {
    const response = await api.create(post("{not json"));
    expect(response.status).toBe(400);
    expect((await errorOf(response)).fields).toEqual({ form: "The body must be valid JSON." });
  });

  it("requires an Idempotency-Key header", async () => {
    const response = await api.create(post(VALID, { "idempotency-key": "" }));
    expect(response.status).toBe(400);
    expect((await errorOf(response)).fields).toHaveProperty("idempotencyKey");
    expect(vi.mocked(repository.createTicket)).not.toHaveBeenCalled();
  });

  it("rejects injected fields instead of ignoring them", async () => {
    const response = await api.create(
      post({ ...VALID, status: "resolved", created_by: "someone-else" }),
    );
    expect(response.status).toBe(400);
    expect(vi.mocked(repository.createTicket)).not.toHaveBeenCalled();
  });

  it("returns field errors for invalid input", async () => {
    const response = await api.create(post({ ...VALID, title: "Fan" }));
    expect((await errorOf(response)).fields?.title).toBe("Title needs at least 5 characters.");
  });

  it.each([
    ["RATE_LIMITED", 429],
    ["IDEMPOTENCY_CONFLICT", 409],
    ["UNAUTHENTICATED", 401],
    ["VALIDATION_FAILED", 400],
  ] as const)("maps a %s rejection to %s", async (code, status) => {
    vi.mocked(repository.createTicket).mockRejectedValue(new ComplaintError(code));
    const response = await api.create(post(VALID));
    expect(response.status).toBe(status);
    expect((await errorOf(response)).code).toBe(code);
  });

  it("turns unexpected failures into a safe 503 without leaking details", async () => {
    vi.mocked(repository.createTicket).mockRejectedValue(new Error("connection reset by 10.0.0.5"));
    const response = await api.create(post(VALID));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("10.0.0.5");
  });

  it("never writes complaint text to the logs, even on failure", async () => {
    vi.mocked(repository.createTicket).mockRejectedValue(new ComplaintError("RATE_LIMITED"));
    await api.create(post(VALID));
    vi.mocked(repository.createTicket).mockResolvedValue({
      id: "c0000000-0000-4000-8000-000000000001",
      reference: "MIR-1001",
      status: "submitted",
      created: true,
    });
    await api.create(post(VALID));

    const logs = logLines.join("\n");
    expect(logLines.length).toBeGreaterThan(0);
    for (const value of Object.values(VALID)) {
      expect(logs).not.toContain(value);
    }
  });
});

describe("POST /api/complaints with AI triage (plan §4)", () => {
  const TICKET = {
    id: "c0000000-0000-4000-8000-000000000001",
    reference: "MIR-1001",
    status: "submitted",
  } as const;
  const triage = vi.fn<(ticketId: string) => Promise<"assigned" | "needs_review" | undefined>>();
  const getTriage = vi.fn((_actorId: string) => triage);
  const aiApi = createComplaintsApi({
    getActor: () => Promise.resolve(actor),
    getClient: () => Promise.resolve(fakeClient),
    getLogger: () => createLogger({ level: "debug", sink: (_level, line) => logLines.push(line) }),
    getTriage,
  });

  beforeEach(() => {
    triage.mockReset();
    getTriage.mockClear();
  });

  it("runs triage after the ticket is stored and returns the status it ended in", async () => {
    vi.mocked(repository.createTicket).mockResolvedValue({ ...TICKET, created: true });
    triage.mockResolvedValue("assigned");

    const response = await aiApi.create(post(VALID));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      id: TICKET.id,
      status: "assigned",
      created: true,
    });
    expect(getTriage).toHaveBeenCalledWith(student.id, expect.anything());
    expect(triage).toHaveBeenCalledWith(TICKET.id);
    expect(vi.mocked(repository.createTicket).mock.invocationCallOrder[0]).toBeLessThan(
      triage.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("never reruns AI for a replayed idempotency key", async () => {
    vi.mocked(repository.createTicket).mockResolvedValue({ ...TICKET, created: false });

    const response = await aiApi.create(post(VALID));

    expect(response.status).toBe(200);
    expect(triage).not.toHaveBeenCalled();
  });

  it("keeps the stored ticket when triage fails or even throws", async () => {
    vi.mocked(repository.createTicket).mockResolvedValue({ ...TICKET, created: true });
    triage.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("provider exploded"));

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await aiApi.create(post(VALID));
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ id: TICKET.id, status: "submitted" });
    }
  });

  it("does not run triage when creation itself failed", async () => {
    vi.mocked(repository.createTicket).mockRejectedValue(new ComplaintError("RATE_LIMITED"));

    expect((await aiApi.create(post(VALID))).status).toBe(429);
    expect(triage).not.toHaveBeenCalled();
  });
});

describe("GET /api/complaints", () => {
  const list = (query = "") => api.list(new Request(`${ORIGIN}/api/complaints${query}`));

  it("requires a signed-in user", async () => {
    actor = null;
    expect((await list()).status).toBe(401);
  });

  it("returns a page with the default size", async () => {
    vi.mocked(repository.listComplaints).mockResolvedValue({ items: [], nextCursor: null });
    const response = await list();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], nextCursor: null });
    expect(vi.mocked(repository.listComplaints)).toHaveBeenCalledWith(fakeClient, {
      limit: 20,
      cursor: undefined,
      statuses: null,
    });
  });

  it("maps the open filter to its set of states", async () => {
    vi.mocked(repository.listComplaints).mockResolvedValue({ items: [], nextCursor: null });
    await list("?status=open&limit=5");
    const options = vi.mocked(repository.listComplaints).mock.calls[0]?.[1];
    expect(options?.limit).toBe(5);
    expect(options?.statuses).toContain("in_progress");
    expect(options?.statuses).not.toContain("closed");
  });

  it.each([
    ["?limit=0", "limit"],
    ["?limit=51", "limit"],
    ["?cursor=forged", "cursor"],
    ["?status=everything", "status"],
  ])("rejects %s", async (query, field) => {
    const response = await list(query);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).fields).toHaveProperty(field);
    expect(vi.mocked(repository.listComplaints)).not.toHaveBeenCalled();
  });
});

describe("GET /api/complaints/[id]", () => {
  const detail = (id: string) => api.detail(new Request(`${ORIGIN}/api/complaints/${id}`), id);

  it("answers 404 for a malformed id without querying", async () => {
    expect((await detail("1 OR 1=1")).status).toBe(404);
    expect(vi.mocked(repository.getComplaint)).not.toHaveBeenCalled();
  });

  it("answers 404 when the ticket is missing or not visible to the caller", async () => {
    vi.mocked(repository.getComplaint).mockResolvedValue(null);
    expect((await detail("c0000000-0000-4000-8000-000000000001")).status).toBe(404);
  });

  it("requires a signed-in user", async () => {
    actor = null;
    expect((await detail("c0000000-0000-4000-8000-000000000001")).status).toBe(401);
  });
});

describe("PATCH /api/complaints/[id]/status", () => {
  const TICKET = "c0000000-0000-4000-8000-000000000001";
  const patch = (body: unknown, headers: Record<string, string> = {}) =>
    api.changeStatus(
      new Request(`${ORIGIN}/api/complaints/${TICKET}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
      TICKET,
    );

  it("applies a valid change and returns the new version", async () => {
    vi.mocked(repository.transitionTicket).mockResolvedValue({
      id: TICKET,
      status: "in_progress",
      version: 4,
    });
    const response = await patch({ target: "in_progress", expectedVersion: 3 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: TICKET, status: "in_progress", version: 4 });
    expect(vi.mocked(repository.transitionTicket)).toHaveBeenCalledWith(fakeClient, TICKET, {
      target: "in_progress",
      expectedVersion: 3,
    });
  });

  it.each([
    ["STALE_VERSION", 409],
    ["INVALID_TRANSITION", 409],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
  ] as const)("maps %s to %s", async (code, status) => {
    vi.mocked(repository.transitionTicket).mockRejectedValue(new ComplaintError(code));
    const response = await patch({ target: "in_progress", expectedVersion: 3 });
    expect(response.status).toBe(status);
    expect((await errorOf(response)).code).toBe(code);
  });

  it("requires a note before resolving, without calling the database", async () => {
    const response = await patch({ target: "resolved", expectedVersion: 3 });
    expect(response.status).toBe(400);
    expect((await errorOf(response)).fields).toHaveProperty("note");
    expect(vi.mocked(repository.transitionTicket)).not.toHaveBeenCalled();
  });

  it("treats a malformed ticket id as not found", async () => {
    const response = await api.changeStatus(
      new Request(`${ORIGIN}/api/complaints/x/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "in_progress", expectedVersion: 1 }),
      }),
      "x",
    );
    expect(response.status).toBe(404);
  });

  it("shares the create endpoint's guards", async () => {
    expect(
      (
        await patch(
          { target: "in_progress", expectedVersion: 1 },
          { origin: "https://evil.example" },
        )
      ).status,
    ).toBe(403);
    actor = null;
    expect((await patch({ target: "in_progress", expectedVersion: 1 })).status).toBe(401);
  });
});

describe("POST /api/complaints/[id]/review", () => {
  const TICKET = "c0000000-0000-4000-8000-000000000001";
  const body = {
    departmentId: "d0000000-0000-4000-8000-000000000001",
    category: "electrical",
    priority: "high",
    expectedVersion: 1,
  };
  const review = (payload: unknown) =>
    api.review(
      new Request(`${ORIGIN}/api/complaints/${TICKET}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
      TICKET,
    );

  it("is for administrators only, refused before the body is used", async () => {
    expect((await review(body)).status).toBe(403);
    actor = {
      ...student,
      role: "department",
      departmentId: "d0000000-0000-4000-8000-000000000001",
    };
    expect((await review(body)).status).toBe(403);
    expect(vi.mocked(repository.assignTicket)).not.toHaveBeenCalled();
  });

  it("assigns for an admin", async () => {
    actor = { ...student, role: "admin" };
    vi.mocked(repository.assignTicket).mockResolvedValue({
      id: TICKET,
      status: "assigned",
      version: 2,
    });
    const response = await review(body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: TICKET, status: "assigned", version: 2 });
  });

  it("rejects an assignment without a real classification", async () => {
    actor = { ...student, role: "admin" };
    const response = await review({ ...body, category: "unclassified" });
    expect(response.status).toBe(400);
  });
});
