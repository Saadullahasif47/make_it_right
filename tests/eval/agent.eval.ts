/**
 * Live evaluation of AI triage against the real Gemini model (master plan P4.01, P4.09).
 * Opt-in and billable against the free-tier quota, so it never runs in CI:
 *
 *   pnpm eval:agent                      # the 30 held-out "eval" reports
 *   EVAL_SPLIT=dev pnpm eval:agent       # the 90 "dev" reports (prompt tuning)
 *   EVAL_LIMIT=3 pnpm eval:agent         # a smoke test of key, model and tool calling
 *
 * Reads GEMINI_API_KEY / GEMINI_MODEL from .env.local. Writes the report to
 * docs/evidence/p4-agent-eval-<prompt version>-<split>.md (dataset ids only, never report text). Waits for the
 * free-tier rate limit are excluded from latency, which measures provider calls only.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createGeminiModelClient } from "@/features/agent/gemini";
import type { ModelClient } from "@/features/agent/model";
import { MAX_TOOL_EXCHANGES, PROMPT_VERSION } from "@/features/agent/prompt";
import { runAgent } from "@/features/agent/run-agent";

import { SEED_SNAPSHOT, loadDataset } from "./dataset";
import {
  outcomeMatchesExpectation,
  predictedCategory,
  summarise,
  type EvalOutcome,
} from "./metrics";

const apiKey = process.env.GEMINI_API_KEY ?? "";
const modelName = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";
const split = process.env.EVAL_SPLIT ?? "eval";
const limit = Number(process.env.EVAL_LIMIT ?? Infinity);
const requestsPerMinute = Number(process.env.EVAL_RPM ?? 10);
const timeoutMs = Number(process.env.AI_TIMEOUT_MS ?? 10_000);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Spaces model calls for the free tier and times only the provider call itself. */
function throttled(inner: ModelClient, timings: { providerMs: number }): ModelClient {
  const interval = 60_000 / requestsPerMinute;
  let nextSlot = 0;
  return {
    model: inner.model,
    startConversation(message) {
      const conversation = inner.startConversation(message);
      return {
        async send(results, deadline) {
          const wait = nextSlot - Date.now();
          if (wait > 0) await sleep(wait);
          nextSlot = Date.now() + interval;
          const started = Date.now();
          try {
            return await conversation.send(results, deadline);
          } finally {
            timings.providerMs += Date.now() - started;
          }
        },
      };
    },
  };
}

describe.skipIf(apiKey === "")(`live triage evaluation (${modelName}, ${PROMPT_VERSION})`, () => {
  it(
    `evaluates the "${split}" split`,
    async () => {
      const items = loadDataset()
        .filter((item) => split === "all" || item.split === split)
        .slice(0, limit);
      const base = createGeminiModelClient({ apiKey, model: modelName });
      const outcomes: EvalOutcome[] = [];
      let rateLimitRetries = 0;

      for (const item of items) {
        let outcome: EvalOutcome | undefined;
        for (let attempt = 0; attempt < 2; attempt++) {
          const timings = { providerMs: 0 };
          // Room for the throttle between calls; the provider time itself is what is reported.
          const deadline = AbortSignal.timeout(
            timeoutMs + (MAX_TOOL_EXCHANGES * 60_000) / requestsPerMinute,
          );
          const result = await runAgent({
            model: throttled(base, timings),
            snapshot: SEED_SNAPSHOT,
            report: item,
            deadline,
          });
          outcome = {
            item,
            decision: result.decision,
            trace: result.trace,
            latencyMs: timings.providerMs,
          };
          const limited =
            result.decision.kind === "review" && result.decision.failureCode === "RATE_LIMITED";
          if (!limited) break;
          rateLimitRetries += 1;
          await sleep(65_000);
        }
        if (outcome !== undefined) outcomes.push(outcome);
        process.stdout.write(
          `${item.id} ${outcome?.decision.kind ?? "?"} ${outcome?.decision.kind === "review" ? outcome.decision.failureCode : (predictedCategory(outcome?.decision ?? { kind: "review", failureCode: "INVALID_OUTPUT" }) ?? "")}\n`,
        );
      }

      const summary = summarise(outcomes, SEED_SNAPSHOT);
      writeReport(outcomes, summary, rateLimitRetries);

      // Release blockers, not accuracy targets (plan §8: report measurements honestly).
      expect(summary.unauthorisedStateChanges).toBe(0);
      expect(summary.mustReviewCaught).toBe(summary.mustReviewTotal);
    },
    60 * 60 * 1000,
  );
});

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function writeReport(
  outcomes: readonly EvalOutcome[],
  summary: ReturnType<typeof summarise>,
  retries: number,
) {
  const rows = outcomes.map((outcome) => {
    const decision = outcome.decision;
    const code = decision.kind === "review" ? decision.failureCode : "";
    return `| ${outcome.item.id} | ${outcome.item.tags.join(", ") || "-"} | ${outcome.item.expected} | ${outcome.item.category} | ${predictedCategory(decision) ?? "-"} | ${decision.kind} | ${code || "-"} | ${outcome.trace.filter((entry) => entry.verdict === "rejected").length} | ${outcome.latencyMs} | ${outcomeMatchesExpectation(outcome) ? "yes" : "no"} |`;
  });
  const perClass = summary.macroF1.perClass.map(
    (entry) =>
      `| ${entry.category} | ${entry.support} | ${entry.precision.toFixed(2)} | ${entry.recall.toFixed(2)} | ${entry.f1.toFixed(2)} |`,
  );
  const tags = Object.entries(summary.byTag).map(
    ([tag, value]) => `| ${tag} | ${value.total} | ${value.correct} |`,
  );
  const report = `# Evidence: AI triage evaluation (${split} split)

Generated by \`pnpm eval:agent\` on ${new Date().toISOString().slice(0, 10)} with **${modelName}**, prompt **${PROMPT_VERSION}**,
${summary.items} fictional reports from \`tests/eval/fixtures/complaints.json\`. Routing used the seeded departments and rules.
Latency counts provider calls only (free-tier throttling excluded). Rate-limit retries during the run: ${retries}.

## Summary

| Measure | Result |
| --- | --- |
| Category macro-F1 (missing prediction = miss) | **${summary.macroF1.macro.toFixed(3)}** |
| Routed automatically | ${summary.routed} / ${summary.items} |
| Routed to the labelled category | ${summary.routedCorrectCategory} / ${summary.routed} |
| Human-review rate | ${pct(summary.reviewRate)} |
| "Should route" reports that were routed | ${summary.shouldRouteRouted} / ${summary.shouldRouteTotal} |
| "Must review" reports (safety, not maintenance) sent to review | **${summary.mustReviewCaught} / ${summary.mustReviewTotal}** |
| Rejected tool calls (validation or policy) | ${summary.rejectedToolCalls} in ${summary.itemsWithRejectedCall} reports |
| Unauthorised state changes | **${summary.unauthorisedStateChanges}** |
| Provider latency p50 / p95 / max | ${summary.latency.p50} / ${summary.latency.p95} / ${summary.latency.max} ms |

Review reasons: ${
    Object.entries(summary.failureCodes)
      .map(([code, count]) => `${code} ${count}`)
      .join(", ") || "none"
  }.

## Per category

| Category | Support | Precision | Recall | F1 |
| --- | --- | --- | --- | --- |
${perClass.join("\n")}

## By report type (outcome matched the expectation)

| Type | Reports | Matched |
| --- | --- | --- |
${tags.join("\n")}

## Every report

| Id | Type | Expected | Label | Predicted | Decision | Review code | Rejected calls | Latency ms | Matched |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join("\n")}
`;
  mkdirSync("docs/evidence", { recursive: true });
  writeFileSync(`docs/evidence/p4-agent-eval-${PROMPT_VERSION}-${split}.md`, report);
}
