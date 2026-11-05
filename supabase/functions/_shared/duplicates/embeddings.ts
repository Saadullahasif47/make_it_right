import { z } from "zod";

import { JobError } from "../jobs/types.ts";
import { sanitizeForModel } from "../text/sanitize.ts";

/** Plan v2 F2.01: one pinned model, 768 dimensions. */
export const EMBEDDING_DIMENSIONS = 768;

const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com";

export interface EmbeddingOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string | undefined;
  readonly fetch: typeof fetch;
}

export interface EmbeddingSource {
  readonly title: string;
  readonly description: string;
  readonly category: string;
}

/**
 * The text that represents a report for matching (plan §07 step 8): title, description and
 * category, with personal identifiers removed. Location is not embedded; the ranker compares it
 * exactly instead.
 */
export function canonicalText(source: EmbeddingSource): string {
  const category =
    source.category === "unclassified" ? "" : `Category: ${source.category.replace("_", " ")}.`;
  return [sanitizeForModel(source.title, 120), sanitizeForModel(source.description, 2000), category]
    .filter((part) => part !== "")
    .join("\n");
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const replySchema = z.object({
  embedding: z.object({ values: z.array(z.number()) }),
});

/** Unit length, so cosine similarity equals the dot product whatever the provider returns. */
export function normalise(values: readonly number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) {
    throw new JobError("INVALID_OUTPUT", false);
  }
  return values.map((value) => value / norm);
}

/**
 * One embedContent call (F2.02). Failures use the same codes as the other AI calls:
 * RATE_LIMITED, PROVIDER_UNAVAILABLE and TIMEOUT retry; PROVIDER_REJECTED and INVALID_OUTPUT do
 * not.
 */
export async function embedText(
  options: EmbeddingOptions,
  text: string,
  signal: AbortSignal,
): Promise<number[]> {
  const model = encodeURIComponent(options.model);
  const url = `${(options.baseUrl ?? GOOGLE_BASE_URL).replace(/\/+$/, "")}/v1beta/models/${model}:embedContent`;
  let response: Response;
  try {
    response = await options.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
      body: JSON.stringify({
        model: `models/${options.model}`,
        content: { parts: [{ text }] },
        taskType: "SEMANTIC_SIMILARITY",
        outputDimensionality: EMBEDDING_DIMENSIONS,
      }),
      signal,
    });
  } catch (error) {
    throw new JobError(signal.aborted ? "TIMEOUT" : "PROVIDER_UNAVAILABLE", true, { cause: error });
  }

  if (response.status === 429) throw new JobError("RATE_LIMITED", true);
  if (response.status === 408 || response.status >= 500)
    throw new JobError("PROVIDER_UNAVAILABLE", true);
  if (!response.ok) throw new JobError("PROVIDER_REJECTED", false);

  const parsed = replySchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new JobError("INVALID_OUTPUT", false, { cause: parsed.error });
  }
  const values = parsed.data.embedding.values;
  if (values.length !== EMBEDDING_DIMENSIONS || values.some((value) => !Number.isFinite(value))) {
    throw new JobError("INVALID_OUTPUT", false);
  }
  return normalise(values);
}
