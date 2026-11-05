import { JobError } from "../jobs/types.ts";

import { MODEL_OUTPUT_JSON_SCHEMA, modelOutputSchema, type ModelOutput } from "./schema.ts";

export interface VisionOptions {
  readonly apiKey: string;
  readonly model: string;
  /** Defaults to Google's endpoint; the local test stub in development only. */
  readonly baseUrl?: string | undefined;
  readonly fetch: typeof fetch;
}

export interface VisionRequest {
  readonly systemInstruction: string;
  readonly message: string;
  readonly image: Uint8Array;
  readonly mimeType: string;
}

const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com";
const OUTPUT_TOKEN_BUDGET = 1024;

/** Base64 without Node's Buffer, so the same code runs in Deno and Node. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/** The answer text of a generateContent reply (thought parts skipped), and whether it was blocked. */
function readReply(body: unknown): { readonly text: string; readonly blocked: boolean } {
  if (typeof body !== "object" || body === null) {
    return { text: "", blocked: false };
  }
  const record = body as {
    promptFeedback?: { blockReason?: string };
    candidates?: {
      finishReason?: string;
      content?: { parts?: { text?: string; thought?: boolean }[] };
    }[];
  };
  const candidate = record.candidates?.[0];
  const blocked =
    record.promptFeedback?.blockReason !== undefined ||
    ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY"].includes(
      candidate?.finishReason ?? "",
    );
  const text = (candidate?.content?.parts ?? [])
    .filter((part) => part.thought !== true && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("");
  return { text, blocked };
}

/**
 * One multimodal generateContent call with structured JSON output (plan v2 F1.04). Every
 * outcome is either a validated ModelOutput or a JobError with a stable code:
 *   RATE_LIMITED, PROVIDER_UNAVAILABLE, TIMEOUT    retryable
 *   PROVIDER_REJECTED, INVALID_OUTPUT              not retryable (a person looks instead)
 * Nothing the model returns is trusted until it passes the Zod schema.
 */
export async function analyseImage(
  options: VisionOptions,
  request: VisionRequest,
  signal: AbortSignal,
): Promise<ModelOutput> {
  const url = `${(options.baseUrl ?? GOOGLE_BASE_URL).replace(/\/+$/, "")}/v1beta/models/${encodeURIComponent(options.model)}:generateContent`;
  let response: Response;
  try {
    response = await options.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.systemInstruction }] },
        contents: [
          {
            role: "user",
            parts: [
              { text: request.message },
              { inlineData: { mimeType: request.mimeType, data: toBase64(request.image) } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: MODEL_OUTPUT_JSON_SCHEMA,
          maxOutputTokens: OUTPUT_TOKEN_BUDGET,
          thinkingConfig: { thinkingLevel: "MINIMAL" },
        },
      }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) {
      throw new JobError("TIMEOUT", true, { cause: error });
    }
    throw new JobError("PROVIDER_UNAVAILABLE", true, { cause: error });
  }

  if (response.status === 429) {
    throw new JobError("RATE_LIMITED", true);
  }
  if (response.status === 408 || response.status >= 500) {
    throw new JobError("PROVIDER_UNAVAILABLE", true);
  }
  if (!response.ok) {
    throw new JobError("PROVIDER_REJECTED", false);
  }

  const { text, blocked } = readReply(await response.json().catch(() => null));
  if (blocked) {
    throw new JobError("PROVIDER_REJECTED", false);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new JobError("INVALID_OUTPUT", false, { cause: error });
  }
  const parsed = modelOutputSchema.safeParse(json);
  if (!parsed.success) {
    throw new JobError("INVALID_OUTPUT", false, { cause: parsed.error });
  }
  return parsed.data;
}
