/**
 * Repair verification evaluation (plan v2 A5.04, F4.06) against the live Gemini model, on 30
 * labelled synthetic before/after pairs (tests/eval/verification/dataset.json, drawn by
 * `pnpm dataset:verification`). Opt-in and billable against the free-tier quota, so it never runs
 * in CI:
 *
 *   pnpm eval:verification
 *
 * It uses the worker's own prompt, paired-image call and caution policy, one test per pair (a
 * slow provider costs one pair, never the run), with the queue's retries. Writes
 * docs/evidence/a5-verification-eval.md. The numbers are agreement with a person's labels on
 * drawings: they are not engineering or safety assurance (F4.06).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { retryDelaySeconds } from "../../supabase/functions/_shared/jobs/retry.ts";
import { JobError } from "../../supabase/functions/_shared/jobs/types.ts";
import {
  VERIFY_SYSTEM_INSTRUCTION,
  buildVerificationMessage,
} from "../../supabase/functions/_shared/repair-verification/prompt.ts";
import {
  COMPARISON_JSON_SCHEMA,
  VERIFY_PROMPT_VERSION,
  comparisonSchema,
  toStoredVerification,
  type AiStatus,
} from "../../supabase/functions/_shared/repair-verification/schema.ts";
import { generateStructured } from "../../supabase/functions/_shared/visual-inspection/gemini-vision.ts";

interface Pair {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly description: string;
  readonly label: AiStatus;
}

interface Graded {
  readonly pair: Pair;
  /** Null when the provider failed every attempt. */
  readonly status: AiStatus | null;
  readonly modelSaid: AiStatus | null;
  readonly flags: readonly string[];
  readonly errors: readonly string[];
}

const apiKey = process.env.GEMINI_API_KEY ?? "";
const model =
  process.env.GEMINI_VISION_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";
const requestsPerMinute = Number(process.env.EVAL_RPM ?? 10);
const MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const root = join(process.cwd(), "tests", "eval", "verification");
const { pairs } = JSON.parse(readFileSync(join(root, "dataset.json"), "utf8")) as {
  pairs: Pair[];
};
const STATUSES: readonly AiStatus[] = [
  "visually_improved",
  "possibly_unresolved",
  "inconclusive",
  "not_comparable",
];

let last = 0;
async function compare(pair: Pair) {
  await sleep(Math.max(0, last + 60_000 / requestsPerMinute - Date.now()));
  last = Date.now();
  const image = (side: string) =>
    new Uint8Array(readFileSync(join(root, "images", `${pair.id}-${side}.png`)));
  return generateStructured(
    { apiKey, model, fetch },
    {
      systemInstruction: VERIFY_SYSTEM_INSTRUCTION,
      message: buildVerificationMessage(pair.id.toUpperCase(), [
        { title: pair.title, description: pair.description },
      ]),
      images: [
        { label: "BEFORE photo:", bytes: image("before"), mimeType: "image/png" },
        { label: "AFTER photo:", bytes: image("after"), mimeType: "image/png" },
      ],
      jsonSchema: COMPARISON_JSON_SCHEMA,
    },
    comparisonSchema,
    AbortSignal.timeout(60_000),
  );
}

async function grade(pair: Pair): Promise<Graded> {
  const errors: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const answer = await compare(pair);
      const stored = toStoredVerification(answer);
      return {
        pair,
        status: stored.ai_status,
        modelSaid: answer.assessment,
        flags: stored.uncertainty_flags,
        errors,
      };
    } catch (error) {
      if (!(error instanceof JobError)) throw error;
      errors.push(error.code);
      // A non-retryable answer (INVALID_OUTPUT) is what the worker would send to a person.
      if (!error.retryable) break;
      if (attempt < MAX_ATTEMPTS) await sleep(retryDelaySeconds(attempt, () => 0.5) * 1000);
    }
  }
  return { pair, status: null, modelSaid: null, flags: [], errors };
}

const pct = (part: number, whole: number) =>
  whole === 0 ? "n/a" : `${((100 * part) / whole).toFixed(1)}%`;

function report(graded: readonly Graded[]): string {
  const answered = graded.filter((entry) => entry.status !== null);
  const agree = answered.filter((entry) => entry.status === entry.pair.label);
  // False acceptance: the pictures do not show a fixed fault, yet the suggestion says improved.
  const falseAccept = answered.filter(
    (entry) => entry.status === "visually_improved" && entry.pair.label !== "visually_improved",
  );
  const missedFix = answered.filter(
    (entry) => entry.pair.label === "visually_improved" && entry.status !== "visually_improved",
  );
  const policyChanged = answered.filter((entry) => entry.status !== entry.modelSaid);
  const cell = (label: AiStatus, status: AiStatus) =>
    String(answered.filter((e) => e.pair.label === label && e.status === status).length);

  return `# Evidence: A5 repair verification evaluation (30 synthetic pairs)

> **Synthetic scenario evaluation.** 30 drawn before/after pairs written for this test
> (\`scripts/generate-verification-dataset.mts\`), labelled by what a person sees in the two
> pictures. Agreement with these labels is **not** engineering or safety assurance: a photo
> cannot show that a repair works, and every case still needs a person's confirmation (F4.06).

- Run: ${new Date().toISOString().slice(0, 10)}, model \`${model}\`, prompt \`${VERIFY_PROMPT_VERSION}\`
- Code path: the worker's prompt, paired-image call and caution policy (one request per pair)
- Pairs: 14 fixed, 5 unfixed, 3 partly fixed, 4 with a dark or blurred after picture, 4 showing a
  different object

## Results

| Measure | Value |
| ------- | ----- |
| Pairs answered | ${String(answered.length)} of ${String(graded.length)} |
| Agreement with the person's label | **${String(agree.length)} / ${String(answered.length)} (${pct(agree.length, answered.length)})** |
| False acceptance (said "looks improved", label says otherwise) | **${String(falseAccept.length)}**${falseAccept.length === 0 ? "" : ` (${falseAccept.map((e) => e.pair.id).join(", ")})`} |
| Fixed pairs not recognised as improved | ${String(missedFix.length)} of ${String(graded.filter((e) => e.pair.label === "visually_improved").length)} |
| Answers made more cautious by the policy | ${String(policyChanged.length)} |
| Provider errors (retried as the queue would) | ${String(graded.reduce((sum, e) => sum + e.errors.length, 0))} |

## Confusion (rows: person's label, columns: stored suggestion)

| Label \\ Suggestion | ${STATUSES.join(" | ")} |
| --- | ${STATUSES.map(() => "---").join(" | ")} |
${STATUSES.map((label) => `| ${label} | ${STATUSES.map((status) => cell(label, status)).join(" | ")} |`).join("\n")}

## Every pair

| Pair | Kind | Label | Model said | Stored | Flags | Agrees |
| ---- | ---- | ----- | ---------- | ------ | ----- | ------ |
${graded
  .map(
    (e) =>
      `| ${e.pair.id} | ${e.pair.kind} | ${e.pair.label} | ${e.modelSaid ?? "-"} | ${e.status ?? `no answer (${e.errors.join(", ")})`} | ${e.flags.join(", ") || "none"} | ${e.status === e.pair.label ? "yes" : "**no**"} |`,
  )
  .join("\n")}

## Reading

- The safety-relevant error is false acceptance: a suggestion of "looks improved" for a repair
  that is not visibly done. Even then nothing closes on its own; the reporter or an administrator
  must confirm, and a dispute reopens the work.
- "Inconclusive" and "not comparable" ask a person to look; they cost time, not safety.
- 30 drawn pairs and one run: one pair moves agreement by about 3 points. Real photos (angles,
  lighting, clutter) will be harder; this set checks the pipeline and the policy, not field accuracy.
`;
}

describe("repair verification against the live model (30 synthetic pairs)", () => {
  const graded: Graded[] = [];

  beforeAll(() => {
    expect(apiKey, "GEMINI_API_KEY must be set in .env.local").not.toBe("");
    expect(pairs).toHaveLength(30);
  });

  afterAll(() => {
    mkdirSync("docs/evidence", { recursive: true });
    const order = new Map(pairs.map((pair, index) => [pair.id, index]));
    graded.sort((a, b) => (order.get(a.pair.id) ?? 0) - (order.get(b.pair.id) ?? 0));
    writeFileSync("docs/evidence/a5-verification-eval.md", report(graded));
  });

  it.each(pairs.map((pair) => [pair.id, pair] as const))(
    "%s",
    async (_id, pair) => {
      const entry = await grade(pair);
      graded.push(entry);
      process.stdout.write(
        `${pair.id} label=${pair.label} model=${entry.modelSaid ?? "-"} stored=${entry.status ?? "-"} ${entry.flags.join(",")} ${entry.errors.join(",")}\n`,
      );
    },
    10 * 60_000,
  );
});
