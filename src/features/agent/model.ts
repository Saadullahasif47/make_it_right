import type { ToolCall } from "./tools";

export interface ToolResult {
  readonly call: ToolCall;
  readonly response: Readonly<Record<string, unknown>>;
}

export interface ModelTurn {
  /** Tool calls in the order the model made them; empty when it answered in text instead. */
  readonly calls: readonly ToolCall[];
}

/**
 * One stateful conversation with a model about one report. The provider adapter owns the
 * history (including any opaque provider data such as thought signatures) between turns.
 */
export interface ModelConversation {
  /** The first call sends the report; later calls send the results of the previous turn's calls. */
  send(results: readonly ToolResult[], deadline: AbortSignal): Promise<ModelTurn>;
}

/** The only door to an AI provider. Tests substitute it; production uses the Gemini adapter. */
export interface ModelClient {
  readonly model: string;
  startConversation(reportMessage: string): ModelConversation;
}
