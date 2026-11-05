/**
 * Duplicate-detection evaluation (plan v2 A3.04, F2.06) against the real embedding model, on 60
 * labelled synthetic report pairs (tests/eval/duplicates/pairs.json): 30 duplicates and 30 hard
 * negatives. Opt-in and billable against the free-tier quota, so it never runs in CI:
 *
 *   pnpm eval:duplicates
 *
 * It uses the worker's own canonical text, embedding adapter and ranking formula. The threshold
 * is chosen on the even-numbered pairs and reported on the odd-numbered ones (and on all 60).
 * Writes docs/evidence/a3-duplicate-eval.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  canonicalText,
  embedText,
  type EmbeddingSource,
} from "../../supabase/functions/_shared/duplicates/embeddings";
import {
  CANDIDATE_THRESHOLD,
  cosineSimilarity,
  rankingScore,
} from "../../supabase/functions/_shared/duplicates/ranking";

interface Pair {
  readonly id: string;
  readonly duplicate: boolean;
  readonly kind: string;
  readonly sameRoom: boolean;
  readonly categoryMatch: boolean;
  readonly sameAsset: boolean;
  readonly a: EmbeddingSource;
  readonly b: EmbeddingSource;
}

interface Scored {
  readonly pair: Pair;
  readonly similarity: number;
  readonly score: number;
}

const apiKey = process.env.GEMINI_API_KEY ?? "";
const model = process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-2";
const requestsPerMinute = Number(process.env.EVAL_RPM ?? 30);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function metrics(scored: readonly Scored[], threshold: number) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const entry of scored) {
    const proposed = entry.score >= threshold;
    if (entry.pair.duplicate && proposed) tp += 1;
    else if (!entry.pair.duplicate && proposed) fp += 1;
    else if (entry.pair.duplicate) fn += 1;
    else tn += 1;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, tn, precision, recall, f1 };
}

/** Best F1 on the given pairs; ties go to the higher threshold (fewer false suggestions). */
function chooseThreshold(scored: readonly Scored[]): number {
  let best = { threshold: 0.5, f1: -1 };
  for (let step = 30; step <= 95; step += 1) {
    const threshold = step / 100;
    const { f1 } = metrics(scored, threshold);
    if (f1 >= best.f1) best = { threshold, f1 };
  }
  return best.threshold;
}

const fmt = (value: number) => value.toFixed(3);
const row = (label: string, m: ReturnType<typeof metrics>) =>
  `| ${label} | ${fmt(m.precision)} | ${fmt(m.recall)} | **${fmt(m.f1)}** | ${String(m.tp)} | ${String(m.fp)} | ${String(m.fn)} | ${String(m.tn)} |`;

function report(scored: readonly Scored[], chosen: number): string {
  const dev = scored.filter((_, index) => index % 2 === 0);
  const test = scored.filter((_, index) => index % 2 === 1);
  const byKind = new Map<string, number[]>();
  for (const entry of scored) {
    const key = `${entry.pair.duplicate ? "duplicate" : "negative"}: ${entry.pair.kind}`;
    byKind.set(key, [...(byKind.get(key) ?? []), entry.similarity]);
  }
  const mistakes = scored.filter((entry) => entry.pair.duplicate !== entry.score >= chosen);

  return `# Evidence: A3 duplicate detection evaluation (synthetic pairs)

> **Synthetic scenario evaluation.** 60 fictional report pairs written for this test
> (\`tests/eval/duplicates/pairs.json\`): 30 duplicates and 30 hard negatives. The numbers
> describe this set only, not real campus reports.

- Run: ${new Date().toISOString().slice(0, 10)}, embedding model \`${model}\` at 768 dimensions
- Code path: the worker's canonical text, embedding adapter and ranking formula
  (0.6 × similarity + 0.2 × same room + 0.1 × same category + 0.1 × same equipment)
- Threshold chosen on the 30 even-numbered pairs (best F1), reported on the 30 odd-numbered ones

## Results

Chosen threshold: **${chosen.toFixed(2)}**. A candidate is proposed for a person's review at or
above it; nothing is ever linked automatically.

| Set | Precision | Recall | F1 | TP | FP | FN | TN |
| --- | --------- | ------ | -- | -- | -- | -- | -- |
${row("Tuning half (even pairs)", metrics(dev, chosen))}
${row("Held-out half (odd pairs)", metrics(test, chosen))}
${row("All 60 pairs", metrics(scored, chosen))}
${row(`All 60 at the previous default ${CANDIDATE_THRESHOLD.toFixed(2)}`, metrics(scored, CANDIDATE_THRESHOLD))}

## Precision and recall across thresholds (all 60 pairs)

| Threshold | Precision | Recall | F1 |
| --------- | --------- | ------ | -- |
${[0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9]
  .map((threshold) => {
    const m = metrics(scored, threshold);
    return `| ${threshold.toFixed(2)} | ${fmt(m.precision)} | ${fmt(m.recall)} | ${fmt(m.f1)} |`;
  })
  .join("\n")}

## Raw similarity by kind of pair

| Pair kind | Pairs | Mean cosine | Min | Max |
| --------- | ----- | ----------- | --- | --- |
${[...byKind.entries()]
  .map(([kind, values]) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return `| ${kind} | ${String(values.length)} | ${fmt(mean)} | ${fmt(Math.min(...values))} | ${fmt(Math.max(...values))} |`;
  })
  .join("\n")}

## Confusion cases at ${chosen.toFixed(2)}

${
  mistakes.length === 0
    ? "None."
    : `| Pair | Label | Kind | Similarity | Score |
| ---- | ----- | ---- | ---------- | ----- |
${mistakes
  .map(
    (entry) =>
      `| ${entry.pair.id} | ${entry.pair.duplicate ? "duplicate (missed)" : "different (false suggestion)"} | ${entry.pair.kind} | ${fmt(entry.similarity)} | ${fmt(entry.score)} |`,
  )
  .join("\n")}`
}

## Reading

- A false suggestion costs an administrator one "Different problem" click; it never links
  anything. A missed duplicate means two cases for one problem until someone notices. The
  threshold balances the two on the tuning half; the held-out half shows how well that carries
  over.
- 60 short synthetic pairs and one run: a single pair moves a rate by several points.
`;
}

describe("duplicate detection against the live embedding model (synthetic pairs)", () => {
  it(
    "embeds every distinct text, scores every pair and writes the report",
    async () => {
      expect(apiKey, "GEMINI_API_KEY must be set in .env.local").not.toBe("");
      const { pairs } = JSON.parse(
        readFileSync(join(process.cwd(), "tests", "eval", "duplicates", "pairs.json"), "utf8"),
      ) as { pairs: Pair[] };

      const vectors = new Map<string, number[]>();
      const interval = 60_000 / requestsPerMinute;
      for (const pair of pairs) {
        for (const source of [pair.a, pair.b]) {
          const text = canonicalText(source);
          if (vectors.has(text)) continue;
          const started = Date.now();
          vectors.set(
            text,
            await embedText({ apiKey, model, fetch }, text, AbortSignal.timeout(30_000)),
          );
          await sleep(Math.max(0, interval - (Date.now() - started)));
        }
      }

      const scored: Scored[] = pairs.map((pair) => {
        const similarity = cosineSimilarity(
          vectors.get(canonicalText(pair.a)) ?? [],
          vectors.get(canonicalText(pair.b)) ?? [],
        );
        return {
          pair,
          similarity,
          score: rankingScore({
            similarity,
            sameRoom: pair.sameRoom,
            categoryMatch: pair.categoryMatch,
            sameAsset: pair.sameAsset,
          }),
        };
      });
      const chosen = chooseThreshold(scored.filter((_, index) => index % 2 === 0));
      process.stdout.write(
        `chosen threshold ${chosen.toFixed(2)} over ${String(vectors.size)} texts\n`,
      );

      mkdirSync("docs/evidence", { recursive: true });
      writeFileSync("docs/evidence/a3-duplicate-eval.md", report(scored, chosen));
      expect(scored).toHaveLength(60);
    },
    20 * 60_000,
  );
});
