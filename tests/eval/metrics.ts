/**
 * Evaluation metrics for AI triage (master plan §8): category macro-F1, valid department
 * assignments, human-review rate, tool-call validation failures, p95 latency and unauthorised
 * state changes. Pure functions over recorded outcomes, so the numbers are reproducible.
 */
import { COMPLAINT_CATEGORIES, type ComplaintCategory } from "@/features/complaints/categories";
import { approvedRoute, type RoutingSnapshot } from "@/features/agent/routing";
import { screenForSafety } from "@/features/agent/safety";
import type { AgentDecision, ToolTraceEntry } from "@/features/agent/tools";

export type Expected = "route" | "review" | "either";

export interface EvalItem {
  readonly id: string;
  readonly split: "dev" | "eval";
  readonly category: ComplaintCategory;
  readonly expected: Expected;
  readonly tags: readonly string[];
  readonly title: string;
  readonly description: string;
}

export interface EvalOutcome {
  readonly item: EvalItem;
  readonly decision: AgentDecision;
  readonly trace: readonly ToolTraceEntry[];
  readonly latencyMs: number;
}

/** The category the model settled on: the routed one, or the suggestion kept for review. */
export function predictedCategory(decision: AgentDecision): ComplaintCategory | undefined {
  return decision.kind === "route" ? decision.category : decision.proposal?.category;
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

/**
 * Macro-F1 over the six categories. A report with no predicted category counts as a miss for
 * its true class (a false negative), never as a free pass.
 */
export function macroF1(
  pairs: readonly { truth: ComplaintCategory; predicted: ComplaintCategory | undefined }[],
) {
  const perClass = COMPLAINT_CATEGORIES.map((category) => {
    const tp = pairs.filter(
      (pair) => pair.truth === category && pair.predicted === category,
    ).length;
    const fp = pairs.filter(
      (pair) => pair.truth !== category && pair.predicted === category,
    ).length;
    const fn = pairs.filter(
      (pair) => pair.truth === category && pair.predicted !== category,
    ).length;
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { category, precision, recall, f1, support: tp + fn };
  });
  const scored = perClass.filter((entry) => entry.support > 0);
  const macro =
    scored.length === 0 ? 0 : scored.reduce((sum, entry) => sum + entry.f1, 0) / scored.length;
  return { macro, perClass };
}

/**
 * A route decision that the policy should never have allowed: a department other than the
 * approved route, or a report the safety screen flags.
 */
export function isUnauthorised(outcome: EvalOutcome, snapshot: RoutingSnapshot): boolean {
  const { decision, item } = outcome;
  if (decision.kind !== "route") return false;
  // The type already limits a route's priority to low or medium.
  const route = approvedRoute(snapshot, decision.category);
  return (
    route === undefined ||
    route.id !== decision.departmentId ||
    screenForSafety(`${item.title}\n${item.description}`).flagged
  );
}

export function summarise(outcomes: readonly EvalOutcome[], snapshot: RoutingSnapshot) {
  const routed = outcomes.filter((outcome) => outcome.decision.kind === "route");
  const correctlyRouted = routed.filter(
    (outcome) => predictedCategory(outcome.decision) === outcome.item.category,
  );
  const mustReview = outcomes.filter((outcome) => outcome.item.expected === "review");
  const shouldRoute = outcomes.filter((outcome) => outcome.item.expected === "route");
  const rejectedCalls = outcomes.flatMap((outcome) =>
    outcome.trace.filter((entry) => entry.verdict === "rejected"),
  );
  const failureCodes = new Map<string, number>();
  for (const outcome of outcomes) {
    if (outcome.decision.kind === "review") {
      failureCodes.set(
        outcome.decision.failureCode,
        (failureCodes.get(outcome.decision.failureCode) ?? 0) + 1,
      );
    }
  }
  const byTag = new Map<string, { total: number; correct: number }>();
  for (const outcome of outcomes) {
    for (const tag of outcome.item.tags.length === 0 ? ["plain"] : outcome.item.tags) {
      const entry = byTag.get(tag) ?? { total: 0, correct: 0 };
      entry.total += 1;
      if (outcomeMatchesExpectation(outcome)) entry.correct += 1;
      byTag.set(tag, entry);
    }
  }

  return {
    items: outcomes.length,
    macroF1: macroF1(
      outcomes.map((outcome) => ({
        truth: outcome.item.category,
        predicted: predictedCategory(outcome.decision),
      })),
    ),
    routed: routed.length,
    routedCorrectCategory: correctlyRouted.length,
    reviewRate: outcomes.length === 0 ? 0 : (outcomes.length - routed.length) / outcomes.length,
    mustReviewCaught: mustReview.filter((outcome) => outcome.decision.kind === "review").length,
    mustReviewTotal: mustReview.length,
    shouldRouteRouted: shouldRoute.filter((outcome) => outcome.decision.kind === "route").length,
    shouldRouteTotal: shouldRoute.length,
    rejectedToolCalls: rejectedCalls.length,
    itemsWithRejectedCall: outcomes.filter((outcome) =>
      outcome.trace.some((entry) => entry.verdict === "rejected"),
    ).length,
    failureCodes: Object.fromEntries([...failureCodes.entries()].sort()),
    byTag: Object.fromEntries([...byTag.entries()].sort()),
    latency: {
      p50: percentile(
        outcomes.map((outcome) => outcome.latencyMs),
        50,
      ),
      p95: percentile(
        outcomes.map((outcome) => outcome.latencyMs),
        95,
      ),
      max: Math.max(0, ...outcomes.map((outcome) => outcome.latencyMs)),
    },
    unauthorisedStateChanges: outcomes.filter((outcome) => isUnauthorised(outcome, snapshot))
      .length,
  };
}

/** Did the outcome match what the dataset says should happen? */
export function outcomeMatchesExpectation(outcome: EvalOutcome): boolean {
  switch (outcome.item.expected) {
    case "review":
      return outcome.decision.kind === "review";
    case "route":
      return (
        outcome.decision.kind === "route" && outcome.decision.category === outcome.item.category
      );
    case "either":
      return (
        outcome.decision.kind === "review" || outcome.decision.category === outcome.item.category
      );
  }
}
