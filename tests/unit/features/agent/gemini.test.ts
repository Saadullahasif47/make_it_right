import { describe, expect, it } from "vitest";

import { createGeminiModelClient } from "@/features/agent/gemini";
import { PROMPT_VERSION, SYSTEM_INSTRUCTION } from "@/features/agent/prompt";
import { runAgent } from "@/features/agent/run-agent";

import { DEPARTMENTS, REPORT, SNAPSHOT, liveDeadline } from "../../../support/agent";

interface Captured {
  readonly url: string;
  readonly body: Record<string, unknown>;
  readonly headers: Headers;
}

/** A fake Gemini REST endpoint: records each request and answers with the next scripted body. */
function fakeGemini(
  replies: readonly (Record<string, unknown> | { status: number; body: unknown })[],
) {
  const requests: Captured[] = [];
  let index = 0;
  const fetchFn: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push({
      url,
      body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
        string,
        unknown
      >,
      headers: new Headers(init?.headers),
    });
    const reply = replies[index++] ?? {
      status: 500,
      body: { error: { message: "no more replies" } },
    };
    const status = "status" in reply && typeof reply.status === "number" ? reply.status : 200;
    const body = "status" in reply && typeof reply.status === "number" ? reply.body : reply;
    return Promise.resolve(Response.json(body, { status }));
  };
  return { fetchFn, requests };
}

function modelTurn(parts: Record<string, unknown>[]) {
  return { candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }] };
}

const LOOKUP_TURN = modelTurn([
  {
    functionCall: { id: "call-1", name: "find_category_route", args: { category: "electrical" } },
    thoughtSignature: "c2lnbmF0dXJlLW9uZQ==",
  },
]);
const PROPOSE_TURN = modelTurn([
  {
    functionCall: {
      id: "call-2",
      name: "propose_assignment",
      args: {
        category: "electrical",
        department_id: DEPARTMENTS.electrical.id,
        priority: "medium",
        reason: "Corridor lighting has failed.",
      },
    },
  },
]);

describe("Gemini adapter", () => {
  it("sends a strict, tool-only request and routes from the model's function calls", async () => {
    const { fetchFn, requests } = fakeGemini([LOOKUP_TURN, PROPOSE_TURN]);
    const model = createGeminiModelClient({
      apiKey: "test-key",
      model: "gemini-3.1-flash-lite",
      fetch: fetchFn,
    });

    const result = await runAgent({
      model,
      snapshot: SNAPSHOT,
      report: REPORT,
      deadline: liveDeadline(),
    });

    expect(result.decision).toMatchObject({
      kind: "route",
      departmentId: DEPARTMENTS.electrical.id,
    });
    expect(requests).toHaveLength(2);

    const [first, second] = requests;
    expect(first?.url).toContain("/models/gemini-3.1-flash-lite:generateContent");
    expect(first?.headers.get("x-goog-api-key")).toBe("test-key");
    expect(first?.body).toMatchObject({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      toolConfig: {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: [
            "list_departments",
            "find_category_route",
            "propose_assignment",
            "request_human_review",
          ],
        },
      },
      generationConfig: { maxOutputTokens: 1024 },
    });
    const declarations = (first?.body.tools as { functionDeclarations: { name: string }[] }[])[0]
      ?.functionDeclarations;
    expect(declarations?.map((tool) => tool.name)).toEqual([
      "list_departments",
      "find_category_route",
      "propose_assignment",
      "request_human_review",
    ]);

    // Turn two replays the model's turn verbatim (thought signature included), then our result.
    const contents = second?.body.contents as { role: string; parts: Record<string, unknown>[] }[];
    expect(contents.map((content) => content.role)).toEqual(["user", "model", "user"]);
    expect(contents[1]?.parts[0]).toMatchObject({ thoughtSignature: "c2lnbmF0dXJlLW9uZQ==" });
    expect(contents[2]?.parts[0]).toEqual({
      functionResponse: {
        id: "call-1",
        name: "find_category_route",
        response: {
          ok: true,
          category: "electrical",
          department: { id: DEPARTMENTS.electrical.id, name: DEPARTMENTS.electrical.name },
        },
      },
    });
  });

  it("never sends the raw report: identifiers are redacted before the request", async () => {
    const { fetchFn, requests } = fakeGemini([
      modelTurn([{ functionCall: { name: "request_human_review", args: { reason: "other" } } }]),
    ]);
    const model = createGeminiModelClient({ apiKey: "k", model: "m", fetch: fetchFn });

    await runAgent({
      model,
      snapshot: SNAPSHOT,
      report: {
        title: "Lights out",
        description: "Reach me on 0300 1234567 or zara@uni.example.edu",
      },
      deadline: liveDeadline(),
    });

    const sent = JSON.stringify(requests[0]?.body);
    expect(sent).not.toContain("1234567");
    expect(sent).not.toContain("zara@uni.example.edu");
    expect(sent).toContain("[phone]");
  });

  it("makes exactly one HTTP attempt on 429: no hidden SDK retries", async () => {
    const { fetchFn, requests } = fakeGemini([
      {
        status: 429,
        body: { error: { code: 429, message: "Resource exhausted", status: "RESOURCE_EXHAUSTED" } },
      },
      LOOKUP_TURN,
    ]);
    const model = createGeminiModelClient({ apiKey: "k", model: "m", fetch: fetchFn });

    const result = await runAgent({
      model,
      snapshot: SNAPSHOT,
      report: REPORT,
      deadline: liveDeadline(),
    });

    expect(result.decision).toEqual({ kind: "review", failureCode: "RATE_LIMITED" });
    expect(requests).toHaveLength(1);
  });

  it.each([
    [503, "PROVIDER_UNAVAILABLE"],
    [400, "PROVIDER_REJECTED"],
    [403, "PROVIDER_REJECTED"],
  ])("maps HTTP %i to %s", async (status, failureCode) => {
    const { fetchFn } = fakeGemini([
      { status, body: { error: { code: status, message: "failure" } } },
    ]);
    const model = createGeminiModelClient({ apiKey: "k", model: "m", fetch: fetchFn });
    const result = await runAgent({
      model,
      snapshot: SNAPSHOT,
      report: REPORT,
      deadline: liveDeadline(),
    });
    expect(result.decision).toEqual({ kind: "review", failureCode });
  });

  it("treats a blocked or empty candidate as invalid output", async () => {
    const { fetchFn } = fakeGemini([{ candidates: [{ finishReason: "SAFETY" }] }]);
    const model = createGeminiModelClient({ apiKey: "k", model: "m", fetch: fetchFn });
    const result = await runAgent({
      model,
      snapshot: SNAPSHOT,
      report: REPORT,
      deadline: liveDeadline(),
    });
    expect(result.decision).toEqual({ kind: "review", failureCode: "INVALID_OUTPUT" });
  });

  it("aborts the request when the deadline fires", async () => {
    const controller = new AbortController();
    const fetchFn: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("This operation was aborted", "AbortError"));
        });
        controller.abort();
      });
    const model = createGeminiModelClient({ apiKey: "k", model: "m", fetch: fetchFn });
    const result = await runAgent({
      model,
      snapshot: SNAPSHOT,
      report: REPORT,
      deadline: controller.signal,
    });
    expect(result.decision).toEqual({ kind: "review", failureCode: "TIMEOUT" });
  });

  it("has a versioned prompt", () => {
    expect(PROMPT_VERSION).toMatch(/^[a-z0-9][a-z0-9.-]{0,39}$/);
  });
});
