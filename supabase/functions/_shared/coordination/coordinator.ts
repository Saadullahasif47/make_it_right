import { JobError } from "../jobs/types.ts";
import { sanitizeForModel } from "../text/sanitize.ts";

import { modelView, type ApprovedRoute, type CaseContext } from "./context.ts";
import type { Content, CoordinatorModel, ModelCall, Part } from "./model.ts";
import { checkRoute, type Proposal } from "./policy.ts";
import { buildCoordinatorMessage } from "./prompt.ts";
import { READ_TOOLS, TOOL_ARGUMENTS, isToolName, type ToolName } from "./tools.ts";

/** Plan §08: at most four read tools and one final tool per run. */
export const MAX_READS = 4;
/** Model turns, including corrections after a refused call. */
export const MAX_TURNS = 6;

export type Verdict =
  | "ok"
  | "proposal"
  | "review"
  | "unknown_tool"
  | "invalid_args"
  | "out_of_scope"
  | "policy_rejected"
  | "read_budget_exhausted"
  | "not_found";

/** One step of the trace: ids and enums only, never rationale or report text (F3.05). */
export interface TraceStep {
  readonly step: number;
  readonly tool: string;
  readonly args: Readonly<Record<string, string>>;
  readonly verdict: Verdict;
  readonly ms: number;
}

/** The scoped reads the loop may perform; each returns plain data or null when not found. */
export interface ReadTools {
  assetHistory(assetId: string): Promise<unknown>;
  departmentCapacity(departmentId: string): Promise<unknown>;
  relatedCases(locationId: string, category: string | undefined): Promise<unknown>;
}

export type CoordinatorResult =
  | {
      readonly kind: "proposal";
      readonly proposal: Proposal;
      readonly trace: readonly TraceStep[];
      readonly unauthorizedAttempts: number;
    }
  | {
      readonly kind: "review";
      readonly reasonCode: string;
      readonly trace: readonly TraceStep[];
      readonly unauthorizedAttempts: number;
    };

export interface CoordinatorInput {
  readonly model: CoordinatorModel;
  readonly context: CaseContext;
  readonly routes: readonly ApprovedRoute[];
  readonly reads: ReadTools;
  readonly signal: AbortSignal;
  readonly now?: () => number;
}

/** Ids and enums from validated arguments; the free-text rationale is never traced. */
function traceArgs(args: Readonly<Record<string, unknown>>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key !== "rationale" && typeof value === "string") kept[key] = value.slice(0, 64);
  }
  return kept;
}

/** A model-supplied tool name, made safe to store. */
const safeName = (name: string): string =>
  name.replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) || "unnamed";

/**
 * The bounded coordination loop (F3.01-F3.02): the model sees the case and the approved routes,
 * may read up to four times through scoped tools, and must end with a proposal or a request for
 * review. Unknown tools, malformed arguments and ids outside this case are refused, counted as
 * unauthorised attempts and explained to the model; nothing it asks for writes anything.
 */
export async function runCoordinator(input: CoordinatorInput): Promise<CoordinatorResult> {
  const now = input.now ?? Date.now;
  const { context } = input;
  const trace: TraceStep[] = [];
  let unauthorizedAttempts = 0;
  let reads = 0;
  const contents: Content[] = [
    { role: "user", parts: [{ text: buildCoordinatorMessage(context, input.routes) }] },
  ];

  const inScope = (tool: ToolName, args: Readonly<Record<string, unknown>>): boolean => {
    if ("case_id" in args && args.case_id !== context.case_id) return false;
    if (tool === "get_asset_repair_history") return args.asset_id === context.asset?.asset_id;
    if (tool === "find_related_cases") return args.location_id === context.location?.location_id;
    return true;
  };

  for (let turn = 1; turn <= MAX_TURNS; turn += 1) {
    if (input.signal.aborted) throw new JobError("TIMEOUT", true);
    const reply = await input.model.send(contents, input.signal);
    contents.push(reply.content);
    if (reply.calls.length === 0) {
      return { kind: "review", reasonCode: "INVALID_OUTPUT", trace, unauthorizedAttempts };
    }

    const responses: Part[] = [];
    const respond = (call: ModelCall, response: Readonly<Record<string, unknown>>) => {
      responses.push({
        functionResponse: {
          ...(call.id === undefined ? {} : { id: call.id }),
          name: call.name,
          response,
        },
      });
    };

    for (const call of reply.calls) {
      const started = now();
      const record = (tool: string, args: Record<string, string>, verdict: Verdict) => {
        trace.push({ step: trace.length + 1, tool, args, verdict, ms: now() - started });
      };

      if (!isToolName(call.name)) {
        unauthorizedAttempts += 1;
        record(safeName(call.name), {}, "unknown_tool");
        respond(call, { error: "That tool does not exist. Use only the declared tools." });
        continue;
      }
      const parsed = TOOL_ARGUMENTS[call.name].safeParse(call.args);
      if (!parsed.success) {
        record(call.name, {}, "invalid_args");
        respond(call, { error: "The arguments do not match the tool's schema." });
        continue;
      }
      const args = parsed.data as Readonly<Record<string, unknown>>;
      if (!inScope(call.name, args)) {
        unauthorizedAttempts += 1;
        record(call.name, traceArgs(args), "out_of_scope");
        respond(call, { error: "Only this case, its own equipment and its own room can be read." });
        continue;
      }

      if (call.name === "request_admin_review") {
        record(call.name, traceArgs(args), "review");
        return {
          kind: "review",
          reasonCode: `MODEL_${String(args.reason_code)}`,
          trace,
          unauthorizedAttempts,
        };
      }
      if (call.name === "propose_work_order") {
        const proposal: Proposal = {
          departmentId: String(args.department_id),
          category: String(args.category),
          priority: String(args.priority),
          rationale: sanitizeForModel(String(args.rationale), 400),
        };
        const route = checkRoute(proposal, input.routes);
        if (!route.ok) {
          record(call.name, traceArgs(args), "policy_rejected");
          respond(call, { error: route.reason });
          continue;
        }
        record(call.name, traceArgs(args), "proposal");
        return { kind: "proposal", proposal, trace, unauthorizedAttempts };
      }

      if (!READ_TOOLS.includes(call.name) || reads >= MAX_READS) {
        record(call.name, traceArgs(args), "read_budget_exhausted");
        respond(call, {
          error: "No reads left. Finish with propose_work_order or request_admin_review.",
        });
        continue;
      }
      reads += 1;
      let result: unknown;
      switch (call.name) {
        case "get_case_context":
          result = modelView(context);
          break;
        case "get_asset_repair_history":
          result = await input.reads.assetHistory(String(args.asset_id));
          break;
        case "get_department_capacity":
          result = await input.reads.departmentCapacity(String(args.department_id));
          break;
        case "find_related_cases":
          result = await input.reads.relatedCases(
            String(args.location_id),
            typeof args.category === "string" ? args.category : undefined,
          );
          break;
      }
      if (result === null || result === undefined) {
        record(call.name, traceArgs(args), "not_found");
        respond(call, { error: "Nothing found for that id." });
      } else {
        record(call.name, traceArgs(args), "ok");
        respond(call, { result });
      }
    }
    contents.push({ role: "user", parts: responses });
  }

  return { kind: "review", reasonCode: "STEP_LIMIT", trace, unauthorizedAttempts };
}
