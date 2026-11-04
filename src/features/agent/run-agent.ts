import type { AgentFailureCode } from "./failures";
import { classifyProviderError } from "./failures";
import type { ModelClient, ModelTurn, ToolResult } from "./model";
import { MAX_TOOL_EXCHANGES, buildReportMessage } from "./prompt";
import type { RoutingSnapshot } from "./routing";
import { screenForSafety, type SafetyScreen } from "./safety";
import { executeTool, type AgentDecision, type ToolTraceEntry } from "./tools";

export interface AgentInput {
  readonly model: ModelClient;
  /**
   * A second model to start over with when `model` is overloaded or rate limited (each Gemini
   * model has its own capacity and quota). Undefined: one retry on the same model instead.
   */
  readonly fallbackModel?: ModelClient | undefined;
  readonly snapshot: RoutingSnapshot;
  readonly report: { readonly title: string; readonly description: string };
  /** One deadline for the whole attempt: every model call and tool exchange, on either model. */
  readonly deadline: AbortSignal;
}

export interface AgentResult {
  readonly decision: AgentDecision;
  readonly trace: readonly ToolTraceEntry[];
  readonly exchanges: number;
  /** Safety pattern names, never matched text. */
  readonly safetySignals: readonly string[];
  /** Whether a brief provider outage was retried during this attempt. */
  readonly providerRetried: boolean;
  /** The model whose answers produced the decision: the fallback, after a switch. */
  readonly model: string;
}

/**
 * Without a fallback model, a brief provider outage (a 5xx such as "model overloaded", or the
 * network) gets exactly one more try on the same model after this pause, inside the same
 * deadline. Rate limits are not retried on the same model (an immediate retry only spends more
 * quota), and nothing is retried once the deadline has fired.
 */
export const PROVIDER_RETRY_DELAY_MS = 750;

/** Failures that say the model has no capacity for us right now, so another model may. */
const SWITCH_MODEL_FOR: ReadonlySet<AgentFailureCode> = new Set([
  "PROVIDER_UNAVAILABLE",
  "RATE_LIMITED",
]);

/** Waits, unless the deadline fires first. Resolves true if the wait completed. */
function pause(ms: number, deadline: AbortSignal): Promise<boolean> {
  if (deadline.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      deadline.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve(false);
    }
    deadline.addEventListener("abort", onAbort, { once: true });
  });
}

/** One conversation with one model: at most MAX_TOOL_EXCHANGES turns. */
async function converse(
  model: ModelClient,
  input: AgentInput,
  safety: SafetyScreen,
  retrySameModel: boolean,
): Promise<AgentResult> {
  const trace: ToolTraceEntry[] = [];
  let providerRetried = false;
  const conversation = model.startConversation(buildReportMessage(input.report, input.snapshot));
  const done = (decision: AgentDecision, exchanges: number): AgentResult => ({
    decision,
    trace,
    exchanges,
    safetySignals: safety.signals,
    providerRetried,
    model: model.model,
  });

  let results: ToolResult[] = [];
  for (let exchange = 1; exchange <= MAX_TOOL_EXCHANGES; exchange++) {
    let turn: ModelTurn | undefined;
    try {
      turn = await conversation.send(results, input.deadline);
    } catch (error) {
      let failureCode = classifyProviderError(error, input.deadline);
      // One retry per attempt, for a transient outage only, and only while time remains.
      if (retrySameModel && failureCode === "PROVIDER_UNAVAILABLE" && !providerRetried) {
        providerRetried = true;
        if (await pause(PROVIDER_RETRY_DELAY_MS, input.deadline)) {
          try {
            turn = await conversation.send(results, input.deadline);
          } catch (again) {
            failureCode = classifyProviderError(again, input.deadline);
          }
        } else {
          failureCode = "TIMEOUT";
        }
      }
      if (turn === undefined) {
        return done({ kind: "review", failureCode }, exchange);
      }
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

/**
 * One bounded agent invocation (plan §8): each tool call validated before it runs, and a
 * decision or a stable failure code at the end. It never throws: provider failures become review
 * decisions, so the caller always has something to record. When the primary model is overloaded
 * or rate limited and a fallback model is configured, the attempt starts over on the fallback
 * (a fresh conversation: Gemini's thought signatures belong to the model that made them), inside
 * the same deadline, and the switch is recorded in the trace.
 */
export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const safety = screenForSafety(`${input.report.title}\n${input.report.description}`);
  const fallback = input.fallbackModel;
  const first = await converse(input.model, input, safety, fallback === undefined);

  if (
    fallback === undefined ||
    first.decision.kind !== "review" ||
    !SWITCH_MODEL_FOR.has(first.decision.failureCode) ||
    input.deadline.aborted
  ) {
    return first;
  }
  const second = await converse(fallback, input, safety, false);
  return {
    ...second,
    trace: [
      ...first.trace,
      {
        step: first.exchanges,
        tool: "switch_model",
        verdict: "ok",
        code: first.decision.failureCode,
        model: fallback.model,
      },
      ...second.trace,
    ],
    providerRetried: first.providerRetried || second.providerRetried,
  };
}
