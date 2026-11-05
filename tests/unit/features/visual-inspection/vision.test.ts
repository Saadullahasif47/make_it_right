/**
 * The visual-inspection worker code (supabase/functions/_shared/visual-inspection), run in Node:
 * the output contract and review policy, the prompt, the Gemini adapter's exact request and
 * failure codes, and the job handler's integrity checks.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { sanitizeForModel as appSanitize } from "@/features/agent/sanitize";

import { JobError, type ClaimedJob } from "../../../../supabase/functions/_shared/jobs/types";
import { readWorkerSettings } from "../../../../supabase/functions/_shared/jobs/worker";
import { WorkerDatabaseError } from "../../../../supabase/functions/_shared/jobs/worker-db";
import { sanitizeForModel as workerSanitize } from "../../../../supabase/functions/_shared/text/sanitize";
import {
  analyseImage,
  toBase64,
  type VisionOptions,
} from "../../../../supabase/functions/_shared/visual-inspection/gemini-vision";
import { createVisualAnalysisHandler } from "../../../../supabase/functions/_shared/visual-inspection/handler";
import {
  VISUAL_SYSTEM_INSTRUCTION,
  buildVisualReportMessage,
} from "../../../../supabase/functions/_shared/visual-inspection/prompt";
import {
  MODEL_OUTPUT_JSON_SCHEMA,
  VISUAL_PROMPT_VERSION,
  modelOutputSchema,
  toStoredAnalysis,
  type ModelOutput,
} from "../../../../supabase/functions/_shared/visual-inspection/schema";

const PHOTO = new Uint8Array(
  readFileSync(join(process.cwd(), "tests", "fixtures", "evidence", "synthetic-sink.png")),
);

const usable: ModelOutput = {
  visible_observations: ["water pooling under the sink"],
  possible_issue: "possible plumbing leak",
  suggested_category: "plumbing",
  severity_hint: "medium",
  not_visible_or_uncertain: [],
  image_quality: "usable",
  text_consistency: "consistent",
  needs_human_review: false,
  explanation: "Water is visible under the cabinet; its source is not.",
};

function reply(output: unknown, status = 200): Response {
  return Response.json(
    {
      candidates: [
        {
          content: {
            parts: [
              { text: "thinking…", thought: true },
              { text: typeof output === "string" ? output : JSON.stringify(output) },
            ],
          },
          finishReason: "STOP",
        },
      ],
    },
    { status },
  );
}

function vision(fetchMock: VisionOptions["fetch"]): VisionOptions {
  return { apiKey: "test-key", model: "gemini-3.1-flash-lite", fetch: fetchMock };
}

const request = {
  systemInstruction: VISUAL_SYSTEM_INSTRUCTION,
  message: "report",
  image: PHOTO,
  mimeType: "image/png",
};

describe("the output contract and review policy", () => {
  it("keeps a clear, consistent photo out of review and records what is not visible", () => {
    const stored = toStoredAnalysis({
      ...usable,
      not_visible_or_uncertain: ["the pipe behind the cabinet"],
    });
    expect(stored.needs_human_review).toBe(false);
    expect(stored.uncertainty_flags).toEqual(["PARTLY_NOT_VISIBLE"]);
  });

  it.each([
    [{ image_quality: "blurry" }, "IMAGE_BLURRY"],
    [{ image_quality: "dark" }, "IMAGE_DARK"],
    [{ image_quality: "unrelated" }, "IMAGE_UNRELATED"],
    [{ text_consistency: "inconsistent" }, "TEXT_IMAGE_MISMATCH"],
    [{ suggested_category: "unclear" }, "CATEGORY_UNCLEAR"],
    [{ severity_hint: "high" }, "HIGH_SEVERITY"],
    [{ needs_human_review: true }, "MODEL_REQUESTED_REVIEW"],
    [{ explanation: "This is definitely a burst pipe." }, "CERTAINTY_LANGUAGE"],
  ] as const)("sends %j to a person (%s), whatever the model said", (change, flag) => {
    const stored = toStoredAnalysis({ ...usable, ...change });
    expect(stored.needs_human_review).toBe(true);
    expect(stored.uncertainty_flags).toContain(flag);
  });

  it("flags an unclear text match without forcing review", () => {
    const stored = toStoredAnalysis({ ...usable, text_consistency: "unclear" });
    expect(stored.uncertainty_flags).toEqual(["CONSISTENCY_UNCLEAR"]);
    expect(stored.needs_human_review).toBe(false);
  });

  it("cleans and bounds the model's text before it is stored", () => {
    const stored = toStoredAnalysis({
      ...usable,
      visible_observations: ["<script>water</script>‮", "x".repeat(900)],
      explanation: "y".repeat(900),
    });
    expect(stored.visible_observations[0]).not.toMatch(/[<>‮]/);
    expect(stored.visible_observations[1]?.length).toBeLessThanOrEqual(160);
    expect(stored.explanation.length).toBeLessThanOrEqual(400);
  });

  it.each([
    [{ ...usable, extra: "field" }],
    [{ ...usable, suggested_category: "roof" }],
    [{ ...usable, visible_observations: [] }],
    [{ ...usable, severity_hint: "critical" }],
    [{ ...usable, needs_human_review: "no" }],
  ])("rejects malformed output %#", (output) => {
    expect(modelOutputSchema.safeParse(output).success).toBe(false);
  });

  it("asks Gemini for exactly the fields the schema validates", () => {
    expect([...MODEL_OUTPUT_JSON_SCHEMA.required].sort()).toEqual(
      Object.keys(modelOutputSchema.shape).sort(),
    );
  });
});

describe("the prompt", () => {
  it("fences the report and removes identifiers before the model sees it", () => {
    const message = buildVisualReportMessage({
      title: "Leak <b>here</b>",
      description: "Call me on +44 7700 900123 or mail a.student@uni.example.ac.uk",
      building: "ENG",
      room: "WC-105",
    });
    expect(message).toContain("<report>");
    expect(message).toContain("Location: ENG, WC-105");
    expect(message).toContain("[phone]");
    expect(message).toContain("[email]");
    expect(message).not.toContain("<b>");
  });

  it("names its version and treats text in the photo as data", () => {
    expect(VISUAL_SYSTEM_INSTRUCTION).toContain(VISUAL_PROMPT_VERSION);
    expect(VISUAL_SYSTEM_INSTRUCTION).toMatch(/never instructions/i);
  });

  it("uses the same sanitiser as the triage agent", () => {
    const corpus = [
      "Ring 0300 123 4567 now",
      "id 202312345678 ​<x>",
      "https://evil.example/x and www.y.z",
      "a\n\n\n\nb",
      "z".repeat(3000),
    ];
    for (const text of corpus) {
      expect(workerSanitize(text, 200)).toBe(appSanitize(text, 200));
    }
    const strip = (source: string) => source.replace(/^\/\/.*\n/gm, "");
    expect(strip(readFileSync("supabase/functions/_shared/text/sanitize.ts", "utf8"))).toBe(
      strip(readFileSync("src/features/agent/sanitize.ts", "utf8")),
    );
  });
});

describe("analyseImage (Gemini adapter)", () => {
  it("sends the image inline with structured-output settings and the key in a header", async () => {
    const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(reply(usable)),
    );
    const output = await analyseImage(vision(fetchMock), request, AbortSignal.timeout(5_000));
    expect(output).toEqual(usable);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
    );
    expect(url).not.toMatch(/key=/);
    expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(init?.body as string) as {
      contents: { parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] }[];
      generationConfig: {
        responseMimeType: string;
        responseJsonSchema: unknown;
        thinkingConfig: unknown;
      };
    };
    expect(body.contents[0]?.parts[1]?.inlineData).toEqual({
      mimeType: "image/png",
      data: Buffer.from(PHOTO).toString("base64"),
    });
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema).toEqual(MODEL_OUTPUT_JSON_SCHEMA);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "MINIMAL" });
  });

  it.each([
    [429, "RATE_LIMITED", true],
    [503, "PROVIDER_UNAVAILABLE", true],
    [500, "PROVIDER_UNAVAILABLE", true],
    [400, "PROVIDER_REJECTED", false],
    [403, "PROVIDER_REJECTED", false],
  ])("maps HTTP %i to %s (retryable: %s)", async (status, code, retryable) => {
    const fetchMock = () => Promise.resolve(Response.json({ error: {} }, { status }));
    await expect(
      analyseImage(vision(fetchMock), request, AbortSignal.timeout(5_000)),
    ).rejects.toMatchObject({
      code,
      retryable,
    });
  });

  it("refuses malformed JSON and off-contract answers without retrying", async () => {
    for (const answer of ["{not json", { ...usable, suggested_category: "roof" }]) {
      await expect(
        analyseImage(
          vision(() => Promise.resolve(reply(answer))),
          request,
          AbortSignal.timeout(5_000),
        ),
      ).rejects.toMatchObject({ code: "INVALID_OUTPUT", retryable: false });
    }
  });

  it("treats a safety block as a refusal", async () => {
    const blocked = () =>
      Promise.resolve(Response.json({ promptFeedback: { blockReason: "SAFETY" } }));
    await expect(
      analyseImage(vision(blocked), request, AbortSignal.timeout(5_000)),
    ).rejects.toMatchObject({
      code: "PROVIDER_REJECTED",
    });
  });

  it("reports a network failure as retryable and a deadline as a timeout", async () => {
    await expect(
      analyseImage(
        vision(() => Promise.reject(new TypeError("fetch failed"))),
        request,
        AbortSignal.timeout(5_000),
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    const controller = new AbortController();
    controller.abort();
    await expect(
      analyseImage(
        vision(() => Promise.reject(new DOMException("aborted", "AbortError"))),
        request,
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it("encodes base64 exactly like Node", () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, index) => (index * 31) % 256);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});

describe("the visual_analysis handler", () => {
  const job: ClaimedJob = {
    jobId: "0b7a6e00-0000-4000-8000-000000000001",
    msgId: 3,
    jobType: "visual_analysis",
    targetId: "0b7a6e00-0000-4000-8000-000000000002",
    attempt: 2,
  };
  const context = {
    attachment_id: job.targetId,
    complaint_id: "0b7a6e00-0000-4000-8000-000000000003",
    object_path: "0b7a6e00-0000-4000-8000-000000000004/0b7a6e00-0000-4000-8000-000000000002.png",
    mime_type: "image/png",
    byte_size: PHOTO.byteLength,
    sha256: createHash("sha256").update(PHOTO).digest("hex"),
    title: "Leak under sink",
    description: "Water under the cabinet",
    building: "ENG",
    room: "WC-105",
  };

  function setup(
    overrides: {
      image?: Uint8Array<ArrayBuffer>;
      storageStatus?: number;
      rows?: unknown[];
      save?: () => Promise<unknown>;
    } = {},
  ) {
    const rpc = vi.fn((name: string) => {
      if (name === "worker_visual_context") return Promise.resolve(overrides.rows ?? [context]);
      return overrides.save?.() ?? Promise.resolve("analysis-id");
    });
    const fetchMock = vi.fn((url: string) =>
      url.includes("/storage/v1/object/")
        ? Promise.resolve(
            new Response(overrides.image ?? PHOTO.slice(), {
              status: overrides.storageStatus ?? 200,
            }),
          )
        : Promise.resolve(reply(usable)),
    );
    const handler = createVisualAnalysisHandler({
      rpc,
      supabaseUrl: "http://kong:8000",
      serviceKey: "service",
      fetch: fetchMock as unknown as typeof fetch,
      vision: {
        apiKey: "k",
        model: "gemini-3.1-flash-lite",
        fetch: fetchMock as unknown as typeof fetch,
      },
    });
    return { handler, rpc, fetchMock };
  }

  it("analyses the checked photo and saves the result under this attempt", async () => {
    const { handler, rpc } = setup();
    await handler(job, AbortSignal.timeout(5_000));
    expect(rpc).toHaveBeenLastCalledWith("worker_save_visual_analysis", {
      p_job_id: job.jobId,
      p_msg_id: 3,
      p_attempt: 2,
      p_prompt_version: VISUAL_PROMPT_VERSION,
      p_model: "gemini-3.1-flash-lite",
      p_result: toStoredAnalysis(usable),
    });
  });

  it("refuses a photo whose stored bytes differ from the finalised ones", async () => {
    const tampered = PHOTO.slice();
    tampered[PHOTO.byteLength - 1] = (tampered[PHOTO.byteLength - 1] ?? 0) ^ 0xff;
    const { handler, fetchMock } = setup({ image: tampered });
    await expect(handler(job, AbortSignal.timeout(5_000))).rejects.toMatchObject({
      code: "PHOTO_INTEGRITY",
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops for a missing photo, and retries storage that is down", async () => {
    await expect(
      setup({ rows: [] }).handler(job, AbortSignal.timeout(5_000)),
    ).rejects.toMatchObject({
      code: "PHOTO_NOT_FOUND",
    });
    await expect(
      setup({ storageStatus: 404 }).handler(job, AbortSignal.timeout(5_000)),
    ).rejects.toMatchObject({
      code: "PHOTO_NOT_FOUND",
      retryable: false,
    });
    await expect(
      setup({ storageStatus: 502 }).handler(job, AbortSignal.timeout(5_000)),
    ).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
      retryable: true,
    });
  });

  it("turns a value the database refuses into INVALID_OUTPUT", async () => {
    const { handler } = setup({
      save: () => Promise.reject(new WorkerDatabaseError("check", "23514")),
    });
    await expect(handler(job, AbortSignal.timeout(5_000))).rejects.toMatchObject({
      code: "INVALID_OUTPUT",
      retryable: false,
    });
  });

  it("does nothing when AI is off or not configured", async () => {
    for (const unavailable of ["AI_DISABLED", "PROVIDER_NOT_CONFIGURED"] as const) {
      const handler = createVisualAnalysisHandler({
        rpc: vi.fn(),
        supabaseUrl: "http://kong:8000",
        serviceKey: "s",
        fetch: vi.fn(),
        vision: { unavailable },
      });
      await expect(handler(job, AbortSignal.timeout(5_000))).rejects.toEqual(
        new JobError(unavailable, false),
      );
    }
  });
});

describe("worker AI settings", () => {
  const base = {
    SUPABASE_URL: "https://abcd.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    AI_WORKER_SECRET: "a-hosted-secret-that-is-long-enough-123",
  };
  const env = (values: Record<string, string>) => (name: string) => values[name];

  it("reads the AI switch, key and vision model", () => {
    const result = readWorkerSettings(
      env({ ...base, AI_ENABLED: "true", GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-3.5-flash" }),
    );
    expect(result.ok && result.settings.ai).toEqual({
      enabled: true,
      apiKey: "k",
      visionModel: "gemini-3.5-flash",
      baseUrl: undefined,
    });
  });

  it("keeps AI off unless switched on, and refuses the test stub on a hosted project", () => {
    const off = readWorkerSettings(env({ ...base, GEMINI_API_KEY: "k" }));
    expect(off.ok && off.settings.ai.enabled).toBe(false);
    expect(readWorkerSettings(env({ ...base, GEMINI_BASE_URL: "http://127.0.0.1:3199" }))).toEqual({
      ok: false,
      problem: "GEMINI_BASE_URL is for the local stack only",
    });
  });
});
