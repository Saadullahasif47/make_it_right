/**
 * A local stand-in for the Gemini REST API (generateContent), for E2E runs only. The app's
 * real adapter and SDK talk to it through GEMINI_BASE_URL, which the config module accepts
 * only as a loopback address and never on a deployment.
 *
 * It keeps no conversation state: like the real API, each request carries the full history,
 * and the stub derives the turn from it. Markers in the report text script failures:
 *   STUB:429            always answers 429 RESOURCE_EXHAUSTED
 *   STUB:FAIL-ONCE      429 on the first request for that report, normal afterwards
 *   STUB:SLOW           answers after 20 seconds (beyond the app's AI deadline)
 *   STUB:TEXT           answers in text instead of calling a tool
 *   STUB:FABRICATE      keeps proposing a department id that does not exist
 *   STUB:WRONG-FIRST    proposes a fabricated department, then looks up and corrects itself
 * Anything else is classified by keyword, looked up with find_category_route and proposed.
 *
 * Usage: node tests/support/gemini-stub.mts [port]
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const port = Number(process.argv[2] ?? 3199);
const FABRICATED = "9f9f9f9f-1111-4222-8333-444455556666";
const failedOnce = new Set<string>();

interface Part {
  text?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response?: Record<string, unknown> };
}
interface Content {
  role?: string;
  parts?: Part[];
}

const KEYWORDS: readonly (readonly [string, RegExp])[] = [
  ["electrical", /light|socket|switch|fan|power|bulb|wiring|sparking/i],
  ["it_equipment", /projector|computer|printer|wi-?fi|network|screen/i],
  ["plumbing", /tap|leak|toilet|drain|water|pipe/i],
  ["furniture", /chair|desk|table|door|window|lock|cupboard/i],
  ["sanitation", /clean|bin|rubbish|smell|pest|dirty/i],
];

function classify(text: string): string {
  return KEYWORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? "other";
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function callTurn(name: string, args: Record<string, unknown>, turn: number) {
  return {
    candidates: [
      {
        content: {
          role: "model",
          parts: [
            {
              functionCall: { id: `stub-${turn}`, name, args },
              thoughtSignature: `c2lnLXN0dWItJHt0dXJufQ==`,
            },
          ],
        },
        finishReason: "STOP",
      },
    ],
    usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 20, totalTokenCount: 220 },
  };
}

/** The department id from the latest find_category_route result in the history, if any. */
function routedDepartment(contents: Content[]): string | undefined {
  for (const content of [...contents].reverse()) {
    for (const part of content.parts ?? []) {
      const response = part.functionResponse;
      if (response?.name === "find_category_route") {
        const department = response.response?.department as { id?: string } | null | undefined;
        return department?.id ?? undefined;
      }
    }
  }
  return undefined;
}

async function readJson(req: IncomingMessage): Promise<{ contents?: Content[] }> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as { contents?: Content[] };
}

const server = createServer((req, res) => {
  void (async () => {
    if (req.method === "GET" && req.url === "/health") {
      send(res, 200, { ok: true });
      return;
    }
    if (req.method !== "POST" || !/:generateContent$/.test(req.url ?? "")) {
      send(res, 404, { error: { code: 404, message: "Not found", status: "NOT_FOUND" } });
      return;
    }

    const body = await readJson(req);
    const contents = body.contents ?? [];
    const message = contents[0]?.parts?.[0]?.text ?? "";
    // Only the report itself: the message also lists the approved departments.
    const report = /<report>([\s\S]*)<\/report>/.exec(message)?.[1] ?? message;
    const turn = contents.filter((content) => content.role === "model").length + 1;
    const category = classify(report);

    if (
      report.includes("STUB:429") ||
      (report.includes("STUB:FAIL-ONCE") && !failedOnce.has(report))
    ) {
      failedOnce.add(report);
      send(res, 429, {
        error: { code: 429, message: "Resource has been exhausted", status: "RESOURCE_EXHAUSTED" },
      });
      return;
    }
    if (report.includes("STUB:SLOW")) {
      await new Promise((resolve) => setTimeout(resolve, 20_000));
    }
    if (report.includes("STUB:TEXT")) {
      send(res, 200, {
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Probably electrical." }] },
            finishReason: "STOP",
          },
        ],
      });
      return;
    }

    const propose = (departmentId: string) =>
      callTurn(
        "propose_assignment",
        {
          category,
          department_id: departmentId,
          priority: "medium",
          reason: `The report describes a ${category.replace("_", " ")} fault.`,
        },
        turn,
      );

    if (report.includes("STUB:FABRICATE")) {
      send(res, 200, propose(FABRICATED));
      return;
    }
    if (report.includes("STUB:WRONG-FIRST") && turn === 1) {
      send(res, 200, propose(FABRICATED));
      return;
    }

    const department = routedDepartment(contents);
    if (department === undefined) {
      send(res, 200, callTurn("find_category_route", { category }, turn));
      return;
    }
    send(res, 200, propose(department));
  })().catch(() => {
    send(res, 500, { error: { code: 500, message: "stub failure", status: "INTERNAL" } });
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`gemini stub listening on http://127.0.0.1:${port}\n`);
});
