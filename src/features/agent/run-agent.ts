import { classifyProviderError } from "./failures";
import type { ModelClient, ToolResult } from "./model";
import { MAX_TOOL_EXCHANGES, buildReportMessage } from "./prompt";
import type { RoutingSnapshot } from "./routing";
import { screenForSafety } from "./safety";
import { executeTool, type AgentDecision, type ToolTraceEntry } from "./tools";

export interface AgentInput {
  readonly model: ModelClient;
  readonly snapshot: RoutingSnapshot;
  readonly report: { readonly title: string; readonly description: string };
  /** One deadline for the whole attempt: every model call and tool exchange. */
  readonly deadline: AbortSignal;
}

export interface AgentResult {
  readonly decision: AgentDecision;
  readonly trace: readonly ToolTraceEntry[];
  readonly exchanges: number;
  /** Safety pattern names, never matched text. */
  readonly safetySignals: readonly string[];
}

/**
 * One bounded agent invocation (plan §8): at most MAX_TOOL_EXCHANGES model turns, each tool call
 * validated before it runs, and a decision or a stable failure code at the end. It never throws:
 * provider failures become review decisions, so the caller always has something to record.
 */
export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const safety = screenForSafety(`${input.report.title}\n${input.report.description}`);
  const trace: ToolTraceEntry[] = [];
  const conversation = input.model.startConversation(
    buildReportMessage(input.report, input.snapshot),
  );
  const done = (decision: AgentDecision, exchanges: number): AgentResult => ({
    decision,
    trace,
    exchanges,
    safetySignals: safety.signals,
  });

  let results: ToolResult[] = [];
  for (let exchange = 1; exchange <= MAX_TOOL_EXCHANGES; exchange++) {
    let turn;
    try {
      turn = await conversation.send(results, input.deadline);
    } catch (error) {
      return done(
        { kind: "review", failureCode: classifyProviderError(error, input.deadline) },
        exchange,
      );
    }
    if (input.deadline.aborted) {
      return done({ kind: "review", failureCode: "TIMEOUT" }, exchange);
    }
    if (turn.calls.length === 0) {
      return done({ kind: "review", failureCode: "INVALID_OUTPUT" }, exchange);
    }

    results = [];
    for (const call of turn.calls) {
      const outcome = executeTool(call, exchange, { snapshot: input.snapshot, safety });
      trace.push(outcome.trace);
      if (outcome.kind === "final") {
        return done(outcome.decision, exchange);
      }
      results.push({ call, response: outcome.response });
    }
  }
  return done({ kind: "review", failureCode: "STEP_LIMIT" }, MAX_TOOL_EXCHANGES);
}
