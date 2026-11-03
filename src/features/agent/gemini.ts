import "server-only";

import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  ThinkingLevel,
  type Content,
  type GenerateContentConfig,
} from "@google/genai";

import type { ModelClient, ModelConversation, ToolResult } from "./model";
import { SYSTEM_INSTRUCTION, TOOL_DECLARATIONS } from "./prompt";
import { TOOL_NAMES, type ToolCall } from "./tools";

export interface GeminiOptions {
  readonly apiKey: string;
  readonly model: string;
  /** Test stub only; validated as loopback by the config module. */
  readonly baseUrl?: string | undefined;
  /** Injected by unit tests to observe the exact HTTP exchange; production uses global fetch. */
  readonly fetch?: typeof fetch;
}

const OUTPUT_TOKEN_BUDGET = 1024;

/**
 * Gemini adapter for the agent (plan §3, §8): manual function calling, so every call is
 * validated by our code before anything runs. The SDK's own retries are off: a failed attempt
 * goes to review, and bounded retries are an admin decision (P4.08).
 */
export function createGeminiModelClient(options: GeminiOptions): ModelClient {
  const ai = new GoogleGenAI({
    apiKey: options.apiKey,
    httpOptions: {
      retryOptions: { attempts: 1 },
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    },
  });

  const baseConfig: GenerateContentConfig = {
    systemInstruction: SYSTEM_INSTRUCTION,
    tools: [
      {
        functionDeclarations: TOOL_DECLARATIONS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parametersJsonSchema: tool.parameters,
        })),
      },
    ],
    // The model must answer with a declared tool call on every turn, never free text.
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingConfigMode.ANY,
        allowedFunctionNames: [...TOOL_NAMES],
      },
    },
    automaticFunctionCalling: { disable: true },
    maxOutputTokens: OUTPUT_TOKEN_BUDGET,
    // Classification needs no extended reasoning; measured on the real model, MINIMAL answered
    // in about half the time of LOW with the same tool call (docs/evidence/p4-agent.md).
    thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
  };

  return {
    model: options.model,
    startConversation(reportMessage: string): ModelConversation {
      const contents: Content[] = [{ role: "user", parts: [{ text: reportMessage }] }];

      return {
        async send(results: readonly ToolResult[], deadline: AbortSignal) {
          if (results.length > 0) {
            contents.push({
              role: "user",
              parts: results.map(({ call, response }) => ({
                functionResponse: {
                  ...(call.id === undefined ? {} : { id: call.id }),
                  name: call.name,
                  response: { ...response },
                },
              })),
            });
          }

          const reply = await ai.models.generateContent({
            model: options.model,
            contents,
            config: { ...baseConfig, abortSignal: deadline },
          });

          // Keep the model's turn exactly as returned: Gemini 3 needs its thought signatures back.
          const content = reply.candidates?.[0]?.content;
          if (content !== undefined) {
            contents.push(content);
          }

          const calls: ToolCall[] = [];
          for (const part of content?.parts ?? []) {
            const call = part.functionCall;
            if (call?.name !== undefined) {
              calls.push({ id: call.id, name: call.name, args: call.args ?? {} });
            }
          }
          return { calls };
        },
      };
    },
  };
}
