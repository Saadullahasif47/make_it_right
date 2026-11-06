import { JobError } from "../jobs/types.ts";

import { COORDINATOR_SYSTEM_INSTRUCTION } from "./prompt.ts";
import { TOOL_DECLARATIONS, TOOL_NAMES } from "./tools.ts";

/** One part of a Gemini conversation; kept as returned so thought signatures go back unchanged. */
export type Part = Readonly<Record<string, unknown>>;
export interface Content {
  readonly role: "user" | "model";
  readonly parts: readonly Part[];
}

export interface ModelCall {
  readonly id: string | undefined;
  readonly name: string;
  readonly args: unknown;
}

export interface ModelReply {
  readonly content: Content;
  readonly calls: readonly ModelCall[];
}

/** The coordinator's view of a model: send the whole conversation, get its next tool calls. */
export interface CoordinatorModel {
  readonly model: string;
  send(contents: readonly Content[], signal: AbortSignal): Promise<ModelReply>;
}

export interface GeminiToolOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string | undefined;
  readonly fetch: typeof fetch;
}

const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com";

/**
 * Gemini with manual function calling (plan v2 F3.01): every turn must be a call to a declared
 * tool (mode ANY), the SDK is not used, and nothing the model asks for runs before our code has
 * validated it. Failures map to the shared codes; transient ones retry through the queue.
 */
export function createGeminiCoordinatorModel(options: GeminiToolOptions): CoordinatorModel {
  const url = `${(options.baseUrl ?? GOOGLE_BASE_URL).replace(/\/+$/, "")}/v1beta/models/${encodeURIComponent(options.model)}:generateContent`;
  return {
    model: options.model,
    async send(contents, signal) {
      let response: Response;
      try {
        response = await options.fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: COORDINATOR_SYSTEM_INSTRUCTION }] },
            contents,
            tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
            toolConfig: {
              functionCallingConfig: { mode: "ANY", allowedFunctionNames: TOOL_NAMES },
            },
            generationConfig: {
              maxOutputTokens: 1024,
              thinkingConfig: { thinkingLevel: "MINIMAL" },
            },
          }),
          signal,
        });
      } catch (error) {
        throw new JobError(signal.aborted ? "TIMEOUT" : "PROVIDER_UNAVAILABLE", true, {
          cause: error,
        });
      }
      if (response.status === 429) throw new JobError("RATE_LIMITED", true);
      if (response.status === 408 || response.status >= 500) {
        throw new JobError("PROVIDER_UNAVAILABLE", true);
      }
      if (!response.ok) throw new JobError("PROVIDER_REJECTED", false);

      const body = (await response.json().catch(() => null)) as {
        candidates?: { content?: { parts?: Part[] } }[];
        promptFeedback?: { blockReason?: string };
      } | null;
      if (body?.promptFeedback?.blockReason !== undefined) {
        throw new JobError("PROVIDER_REJECTED", false);
      }
      const parts = body?.candidates?.[0]?.content?.parts ?? [];
      const calls: ModelCall[] = [];
      for (const part of parts) {
        const call = part.functionCall as
          { id?: unknown; name?: unknown; args?: unknown } | undefined;
        if (call !== undefined && typeof call.name === "string") {
          calls.push({
            id: typeof call.id === "string" ? call.id : undefined,
            name: call.name,
            args: call.args ?? {},
          });
        }
      }
      return { content: { role: "model", parts }, calls };
    },
  };
}
