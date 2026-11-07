/**
 * A local stand-in for the Gemini REST API (generateContent), for E2E runs only. The app's
 * real adapter and SDK talk to it through GEMINI_BASE_URL, which the config module accepts
 * only as a loopback address and never on a deployment.
 *
 * It keeps no conversation state: like the real API, each request carries the full history,
 * and the stub derives the turn from it. Markers in the report text script failures:
 *   STUB:429            always answers 429 RESOURCE_EXHAUSTED
 *   STUB:FAIL-ONCE      429 for the whole first attempt at that report (its first two requests:
 *                       the primary model and the fallback), normal afterwards
 *   STUB:PRIMARY-DOWN   503 "high demand" from the primary model only; the fallback answers
 *   STUB:SLOW           answers after 20 seconds (beyond the app's AI deadline)
 *   STUB:TEXT           answers in text instead of calling a tool
 *   STUB:FABRICATE      keeps proposing a department id that does not exist
 *   STUB:WRONG-FIRST    proposes a fabricated department, then looks up and corrects itself
 * Anything else is classified by keyword, looked up with find_category_route and proposed.
 *
 * Photo analysis (plan v2 F1): a request that carries an inline image gets a structured JSON
 * answer (category by keyword from the report text). It answers 400 unless the image really is
 * a JPEG, PNG or WebP. Markers in the report text:
 *   STUB:VISION-BLURRY     the photo is blurry (goes to review)
 *   STUB:VISION-MISMATCH   the photo contradicts the report (goes to review)
 *   STUB:VISION-CERTAIN    an overconfident explanation (goes to review)
 *   STUB:VISION-INVALID    malformed JSON (INVALID_OUTPUT)
 *   STUB:429               rate limited, as above
 *
 * Coordination (plan v2 F3): a request that declares propose_work_order is the coordinator. It
 * reads the department's capacity, then proposes the approved route for the category it finds
 * by keyword. Markers in the reports script the hard cases:
 *   STUB:COORD-REVIEW      asks for admin review instead
 *   STUB:COORD-INJECT      first calls a tool that does not exist (delete_case)
 *   STUB:COORD-SCOPE       first reads another piece of equipment (out of scope)
 *   STUB:COORD-WRONG       first proposes a department that is not the approved route
 *   STUB:COORD-HIGH        proposes high priority
 *
 * Repair verification (plan v2 F4): a request whose answer schema has
 * functional_test_not_performed is a before/after comparison (two inline images, both checked).
 * Markers in the case's report text:
 *   STUB:VERIFY-UNRESOLVED  visible signs remain (possibly_unresolved)
 *   STUB:VERIFY-SCENE       the photos show different places (policy: not_comparable)
 *   STUB:VERIFY-DARK        the after photo is too dark (policy: inconclusive)
 *   STUB:VERIFY-OVERCLAIM   says "fully repaired" (policy: inconclusive, wording replaced)
 *   STUB:429                rate limited
 * Anything else answers visually_improved.
 *
 * Embeddings (plan v2 F2): embedContent answers a deterministic 768-dimension vector, a hashed
 * bag of words, so reports with similar wording are similar. Markers in the embedded text:
 *   STUB:EMBED-REJECT      400 (PROVIDER_REJECTED)
 *   STUB:429               rate limited
 *
 * Usage: node tests/support/gemini-stub.mts [port] [host]
 *   host defaults to 127.0.0.1. CI passes 0.0.0.0: on Linux Docker the local Edge worker reaches
 *   the host through the bridge gateway, which cannot connect to a loopback-only server.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const port = Number(process.argv[2] ?? 3199);
const FABRICATED = "9f9f9f9f-1111-4222-8333-444455556666";
/** Requests seen per report, for STUB:FAIL-ONCE. */
const failures = new Map<string, number>();
/** The app's default primary model (server-config.ts); the fallback is any other model. */
const PRIMARY_MODEL = "gemini-3.1-flash-lite";

interface Part {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
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

function isImage(base64: string | undefined): boolean {
  const bytes = Buffer.from(base64 ?? "", "base64");
  const hex = bytes.subarray(0, 12).toString("hex");
  return (
    hex.startsWith("ffd8ff") ||
    hex.startsWith("89504e470d0a1a0a") ||
    (hex.startsWith("52494646") && bytes.subarray(8, 12).toString("latin1") === "WEBP")
  );
}

/** A structured photo analysis, as Gemini returns it with responseMimeType application/json. */
function visionAnswer(report: string): unknown {
  const category = classify(report);
  const answer = {
    visible_observations: [`Visible signs of a ${category.replace("_", " ")} problem`],
    possible_issue: `possible ${category.replace("_", " ")} fault`,
    suggested_category: category,
    severity_hint: "medium",
    not_visible_or_uncertain: ["the cause is not visible"],
    image_quality: report.includes("STUB:VISION-BLURRY") ? "blurry" : "usable",
    text_consistency: report.includes("STUB:VISION-MISMATCH") ? "inconsistent" : "consistent",
    needs_human_review: false,
    explanation: report.includes("STUB:VISION-CERTAIN")
      ? "This is definitely a broken pipe."
      : "The photo shows signs that match the report; the cause cannot be seen.",
  };
  const text = report.includes("STUB:VISION-INVALID") ? "{not json" : JSON.stringify(answer);
  return {
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 80, totalTokenCount: 380 },
  };
}

/** A before/after comparison, as Gemini returns it with responseJsonSchema. */
function verificationAnswer(reports: string): unknown {
  const unresolved = reports.includes("STUB:VERIFY-UNRESOLVED");
  const answer = {
    before_observations: ["A visible fault on the fixture"],
    after_observations: [
      unresolved ? "The same fault is still visible" : "The fault is no longer visible",
    ],
    visible_changes: unresolved ? [] : ["The visible fault appears to be gone"],
    same_scene: reports.includes("STUB:VERIFY-SCENE") ? "no" : "yes",
    before_quality: "usable",
    after_quality: reports.includes("STUB:VERIFY-DARK") ? "dark" : "usable",
    assessment: unresolved ? "possibly_unresolved" : "visually_improved",
    not_visible_or_uncertain: ["Whether it works cannot be seen in a photo"],
    explanation: reports.includes("STUB:VERIFY-OVERCLAIM")
      ? "It is fully repaired and works perfectly."
      : "The visible signs of the problem appear reduced; whether it works cannot be seen.",
    functional_test_not_performed: true,
  };
  return {
    candidates: [
      {
        content: { role: "model", parts: [{ text: JSON.stringify(answer) }] },
        finishReason: "STOP",
      },
    ],
    usageMetadata: { promptTokenCount: 600, candidatesTokenCount: 120, totalTokenCount: 720 },
  };
}

const STOPWORDS = new Set(
  "the and for with from that this there have has was were are not but can our its into all any very".split(
    " ",
  ),
);

/** A hashed bag of words: the same words land in the same dimensions, so similar texts align. */
function stubEmbedding(text: string): number[] {
  const values: number[] = Array.from({ length: 768 }, () => 0);
  const words = text.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  for (const word of words) {
    if (STOPWORDS.has(word)) continue;
    let hash = 2166136261;
    for (const char of word) {
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    }
    values[hash % 768] = (values[hash % 768] ?? 0) + ((hash >>> 16) & 1 ? 1 : -1);
  }
  if (!values.some((value) => value !== 0)) values[0] = 1;
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / norm);
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

/** The coordinator's next call, following the markers in its first message. */
function coordinationTurn(message: string, turn: number) {
  const reports = /<reports>([\s\S]*)<\/reports>/.exec(message)?.[1] ?? "";
  const caseId = /"case_id":"([0-9a-f-]{36})"/.exec(message)?.[1] ?? "";
  const category = classify(reports);
  const routes = [...message.matchAll(/^- ([a-z_]+): [^,\n]+, ([0-9a-f-]{36})$/gm)].map(
    (match) => ({
      category: match[1] ?? "",
      departmentId: match[2] ?? "",
    }),
  );
  const route = routes.find((entry) => entry.category === category) ?? routes[0];
  const wrong = routes.find((entry) => entry.departmentId !== route?.departmentId);
  const propose = (departmentId: string) => ({
    name: "propose_work_order",
    args: {
      case_id: caseId,
      department_id: departmentId,
      category: route?.category ?? category,
      priority: reports.includes("STUB:COORD-HIGH") ? "high" : "medium",
      rationale: `The reports describe a ${category.replace("_", " ")} fault in this room.`,
    },
  });

  const steps: { name: string; args: Record<string, unknown> }[] = [];
  if (reports.includes("STUB:COORD-INJECT"))
    steps.push({ name: "delete_case", args: { case_id: caseId } });
  if (reports.includes("STUB:COORD-SCOPE")) {
    steps.push({
      name: "get_asset_repair_history",
      args: { asset_id: "9f9f9f9f-1111-4222-8333-444455556666" },
    });
  }
  if (reports.includes("STUB:COORD-WRONG") && wrong !== undefined)
    steps.push(propose(wrong.departmentId));
  steps.push({
    name: "get_department_capacity",
    args: { department_id: route?.departmentId ?? "" },
  });
  steps.push(
    reports.includes("STUB:COORD-REVIEW")
      ? { name: "request_admin_review", args: { case_id: caseId, reason_code: "AMBIGUOUS" } }
      : propose(route?.departmentId ?? ""),
  );
  const step = steps[Math.min(turn, steps.length) - 1] ?? steps[steps.length - 1];
  return callTurn(step?.name ?? "request_admin_review", step?.args ?? {}, turn);
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
    if (req.method === "POST" && /:embedContent$/.test(req.url ?? "")) {
      const embed = (await readJson(req)) as { content?: { parts?: Part[] } };
      const text = embed.content?.parts?.[0]?.text ?? "";
      if (text.includes("STUB:EMBED-REJECT")) {
        send(res, 400, { error: { code: 400, message: "Invalid", status: "INVALID_ARGUMENT" } });
        return;
      }
      if (text.includes("STUB:429")) {
        send(res, 429, {
          error: { code: 429, message: "Exhausted", status: "RESOURCE_EXHAUSTED" },
        });
        return;
      }
      send(res, 200, { embedding: { values: stubEmbedding(text) } });
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

    const declared = JSON.stringify((body as { tools?: unknown }).tools ?? []);
    if (declared.includes("propose_work_order")) {
      if (message.includes("STUB:429")) {
        send(res, 429, {
          error: { code: 429, message: "Exhausted", status: "RESOURCE_EXHAUSTED" },
        });
        return;
      }
      send(res, 200, coordinationTurn(message, turn));
      return;
    }

    const schema = JSON.stringify(
      (body as { generationConfig?: { responseJsonSchema?: unknown } }).generationConfig
        ?.responseJsonSchema ?? {},
    );
    if (schema.includes("functional_test_not_performed")) {
      const reports = /<reports>([\s\S]*)<\/reports>/.exec(message)?.[1] ?? "";
      const images = (contents[0]?.parts ?? []).flatMap((part) =>
        part.inlineData === undefined ? [] : [part.inlineData],
      );
      if (reports.includes("STUB:429")) {
        send(res, 429, {
          error: { code: 429, message: "Exhausted", status: "RESOURCE_EXHAUSTED" },
        });
        return;
      }
      if (images.length !== 2 || !images.every((entry) => isImage(entry.data))) {
        send(res, 400, {
          error: { code: 400, message: "Invalid image", status: "INVALID_ARGUMENT" },
        });
        return;
      }
      send(res, 200, verificationAnswer(reports));
      return;
    }

    const image = contents[0]?.parts?.find((part) => part.inlineData !== undefined)?.inlineData;
    if (image !== undefined) {
      if (report.includes("STUB:429")) {
        send(res, 429, {
          error: {
            code: 429,
            message: "Resource has been exhausted",
            status: "RESOURCE_EXHAUSTED",
          },
        });
        return;
      }
      if (!isImage(image.data)) {
        send(res, 400, {
          error: { code: 400, message: "Invalid image", status: "INVALID_ARGUMENT" },
        });
        return;
      }
      send(res, 200, visionAnswer(report));
      return;
    }

    const seen = failures.get(report) ?? 0;
    if (report.includes("STUB:429") || (report.includes("STUB:FAIL-ONCE") && seen < 2)) {
      failures.set(report, seen + 1);
      send(res, 429, {
        error: { code: 429, message: "Resource has been exhausted", status: "RESOURCE_EXHAUSTED" },
      });
      return;
    }
    if (report.includes("STUB:PRIMARY-DOWN") && (req.url ?? "").includes(`/${PRIMARY_MODEL}:`)) {
      send(res, 503, {
        error: {
          code: 503,
          message: "This model is currently experiencing high demand.",
          status: "UNAVAILABLE",
        },
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

const host = process.argv[3] ?? "127.0.0.1";
server.listen(port, host, () => {
  process.stdout.write(`gemini stub listening on http://${host}:${port}\n`);
});
