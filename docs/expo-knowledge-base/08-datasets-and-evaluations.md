# 08. Datasets and evaluations

All numbers below are copied from the evidence reports in [`docs/evidence/`](../evidence). No
evaluation was re-run for this document. Every dataset is **synthetic**: written or drawn by the
project team, fictional, and labelled by the team.

## Summary

| #   | Dataset                   | Size                                                         | Tests               | Headline result (held-out or full run)                                | Report                                                                                               |
| --- | ------------------------- | ------------------------------------------------------------ | ------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | Routing reports           | 120 texts (90 dev / 30 eval)                                 | AI routing (base)   | macro-F1 **0.981** on 30 held-out (`triage-v3`); 3/3 must-review held | [p4 v3 eval](../evidence/p4-agent-eval-triage-v3-eval.md)                                            |
| 2   | Visual inspection images  | 40 drawings                                                  | F1                  | macro-F1 **0.735** (0.796 clear); 14/14 review-needed caught          | [a2 visual eval](../evidence/a2-visual-eval-visual-v1.md)                                            |
| 3   | Duplicate pairs           | 60 pairs (30/30)                                             | F2                  | held-out P **1.000**, R **0.800**, F1 **0.889** at threshold 0.82     | [a3 duplicate eval](../evidence/a3-duplicate-eval.md)                                                |
| 4   | Coordination scenarios    | 25 scenarios                                                 | F3                  | **25/25** correct outcomes; 0 risky auto-commits                      | [a4 coordinator eval](../evidence/a4-coordinator-eval.md)                                            |
| 5   | Repair before/after pairs | 30 pairs                                                     | F4                  | Run 1 **23/25** agree (2 false acceptances); run 2 **17/21** (3)      | [run 1](../evidence/a5-verification-eval-run1.md), [run 2](../evidence/a5-verification-eval-run2.md) |
| 6   | LAB-204 demo photos       | 3 drawings                                                   | Live demo only      | Not an evaluation set                                                 | [`docs/demo/photos`](../demo/photos)                                                                 |
| —   | Synthetic campus (seed)   | 3 buildings, 36 rooms, 12 equipment, 60 cases, 6 departments | Demo, F5, F6, pgTAP | Not an evaluation set                                                 | [`supabase/seed.sql`](../../supabase/seed.sql)                                                       |

---

## 1. Routing: 120 complaint texts

- **File:** [`tests/eval/fixtures/complaints.json`](../../tests/eval/fixtures/complaints.json).
- **Contents:** 120 fictional reports, 20 per category (electrical, IT equipment, plumbing,
  furniture, sanitation, other). Expected outcome: 105 "route", 9 "review", 6 "either". Tags:
  18 misspellings, 12 adversarial (instructions to the AI), 6 ambiguous, 6 safety, 3 not
  maintenance.
- **Labels:** each report has a category and an expected outcome, assigned by the authors.
- **Split:** 90 `dev` (used to tune prompts), 30 `eval` (held out; scored only for `triage-v1` and
  `triage-v3`, never used for tuning).
- **Method:** `pnpm eval:agent` runs the real agent code against the live model with the seeded
  departments and rules.

| Measure (30 held-out)              | `triage-v1`    | `triage-v3`       |
| ---------------------------------- | -------------- | ----------------- |
| Category macro-F1                  | 0.880          | **0.981**         |
| Routed automatically               | 22 / 30        | 25 / 30           |
| Routed to the labelled category    | 20 / 22        | **25 / 25**       |
| Human-review rate                  | 26.7%          | 16.7%             |
| Must-review reports sent to review | 3 / 3          | **3 / 3**         |
| Unauthorised state changes         | 0              | 0                 |
| Provider latency p50 / p95         | 5.6 s / 16.8 s | **1.1 s / 4.1 s** |

On the 90 dev reports `triage-v3` scored macro-F1 0.936, 79/90 routed, 76/79 to the right category,
6/6 must-review held.

**Keyword fallback** on all 120: routes 65 (all correct), holds the 6 safety reports, leaves 49 to a
person ([ADR 0005](../adr/0005-bounded-ai-triage.md)). It was tuned on this set.

**What it proves:** on clean synthetic English reports, the prompt and policy route correctly and
keep safety reports with people; the redesign cut latency below the 10 s deadline.
**What it does not prove:** accuracy on real student writing (slang, Urdu, very short reports),
or stability across model updates. Thirty held-out items means one error moves macro-F1 by several
points.

## 2. Visual inspection: 40 synthetic images

- **Files:** [`tests/eval/visual/dataset.json`](../../tests/eval/visual/dataset.json) and
  `tests/eval/visual/images/v01…v40.png` (240 × 180 drawings).
- **Created by:** [`scripts/generate-visual-dataset.mts`](../../scripts/generate-visual-dataset.mts),
  deterministic code that draws simple scenes (shapes and colours). Chosen by the owner on
  2026-11-05.
- **Contents:** 28 clear, 4 blurry, 3 dark, 3 contradicting their report, 2 unrelated. One case
  carries a prompt injection.
- **Labels:** each case has its scene, the expected photo category, and whether a person should
  review it.
- **Split:** no tuning split; the prompt was not tuned on this set.
- **Method:** `pnpm eval:visual` runs the worker's prompt, adapter, schema and review policy.

| Measure                                            | Result                        |
| -------------------------------------------------- | ----------------------------- |
| Macro-F1, all 38 with a photo category             | **0.735**                     |
| Macro-F1, 28 clear photos                          | **0.796**                     |
| Needed a person and got one                        | **14 / 14 (100%)**            |
| Routine clear photos sent to a person anyway       | 7 / 26 (26.9%)                |
| Blurry / dark / contradictory / unrelated detected | 4/4, 3/3, 3/3, 2/2            |
| Injection case                                     | High severity, sent to review |
| Latency p50 / p95                                  | 2.1 s / 5.0 s                 |

Per category: precision 1.00 for the five main categories; recall 0.67–0.88; **"other" 0/3** (peeling
paint, cracked tile, missing ceiling tile came back "unclear").

Review decision matrix: 14 sent and needed, 7 sent but not needed, 0 needed but not sent, 19
correctly not sent.

**What it proves:** the review policy sends every degraded or contradictory image to a person; the
pipeline works end to end. **What it does not:** accuracy on real photographs (texture, clutter,
lighting, angles).

## 3. Duplicate detection: 60 report pairs

- **File:** [`tests/eval/duplicates/pairs.json`](../../tests/eval/duplicates/pairs.json).
- **Contents:** 30 duplicates (25 reworded, 5 with the room unknown) and 30 hard negatives (12
  same room/different problem, 10 same room and category/different fault, 8 same problem type/
  different room).
- **Labels:** duplicate or not, plus same room, category match and same equipment flags.
- **Split:** threshold chosen on the 30 even-numbered pairs (best F1), reported on the 30
  odd-numbered pairs.
- **Method:** `pnpm eval:duplicates` embeds with `gemini-embedding-2` (768 dims) through the
  worker's canonical text and ranking formula.

| Set (threshold 0.82)       | Precision | Recall    | F1        | TP  | FP  | FN  | TN  |
| -------------------------- | --------- | --------- | --------- | --- | --- | --- | --- |
| Tuning half                | 1.000     | 0.867     | 0.929     | 13  | 0   | 2   | 15  |
| **Held-out half**          | **1.000** | **0.800** | **0.889** | 12  | 0   | 3   | 15  |
| All 60                     | 1.000     | 0.833     | 0.909     | 25  | 0   | 5   | 30  |
| All 60 at old default 0.55 | 0.492     | 0.967     | 0.652     | 29  | 30  | 1   | 0   |

Raw cosine similarity: reworded duplicates mean 0.927 (0.875–0.973); "same problem type, different
room" negatives mean 0.896 (up to 0.932). So similarity alone cannot separate them: the room and
equipment terms do.

All 5 misses are duplicates with the room unknown (scores 0.532–0.685). Re-weighting was **not**
done, to avoid overfitting 60 pairs ([ADR 0011](../adr/0011-duplicate-detection-and-shared-cases.md)).

## 4. Coordination: 25 scenarios

- **File:** [`tests/eval/coordination/scenarios.ts`](../../tests/eval/coordination/scenarios.ts).
- **Contents:** routine 8, ambiguous 3, hazard 3, overloaded department 2, repeat failure 2,
  stale case 2, provider down 1, injected instructions 4.
- **Labels:** the expected outcome (commit to a department, approval with reasons, review,
  superseded).
- **Method:** `pnpm eval:coordination`: the worker's own loop, tool schemas, scope checks, prompt
  and adapter with in-memory read tools; then the real approval policy and commit rule. Stale and
  provider-down scenarios are decided by code.

| Measure                                     | Result             |
| ------------------------------------------- | ------------------ |
| Correct outcome                             | **25 / 25**        |
| Unauthorised attempts                       | 0 (none attempted) |
| High-risk or wrong proposals auto-committed | **0**              |
| Live model calls                            | 57 (2.4 per case)  |

**Note:** the model never tried an unauthorised tool here, so the refusal path is proven by stub
tests, not by this run. An earlier attempt on the free tier failed a whole run with 503s; the
script now runs each scenario as its own test with retries.

## 5. Repair verification: 30 before/after pairs

- **Files:** [`tests/eval/verification/dataset.json`](../../tests/eval/verification/dataset.json),
  60 images, generated by
  [`scripts/generate-verification-dataset.mts`](../../scripts/generate-verification-dataset.mts).
- **Contents:** 14 fixed, 5 unfixed, 3 partly fixed, 4 with a dark or blurred after picture, 4
  showing a different object.
- **Labels:** what a person sees: `visually_improved`, `possibly_unresolved`, `inconclusive`,
  `not_comparable`.
- **Method:** `pnpm eval:verification`: the worker's prompt, paired-image call and caution policy.

| Measure                    | Run 1                           | Run 2                                |
| -------------------------- | ------------------------------- | ------------------------------------ |
| Pairs answered             | 25 / 30                         | 21 / 30                              |
| Agreement with label       | **23 / 25 (92%)**               | **17 / 21 (81%)**                    |
| False acceptances          | 2 (r22-partial, r25-poor_after) | 3 (r22-partial, r25, r26-poor_after) |
| Fixed pairs not recognised | 0 / 14                          | 1 / 14                               |
| Provider errors            | 16                              | 28                                   |

The free tier answered "unavailable" for long stretches, so each run is kept separately rather than
merged. **False acceptances are the important number:** the model sometimes calls a partial or
poorly-photographed repair "improved". That is why the AI never closes anything.

## 6. LAB-204 demo photos (3)

[`docs/demo/photos/`](../demo/photos), drawn by
[`scripts/generate-demo-photos.mts`](../../scripts/generate-demo-photos.mts): the projector's error
screen (before), the same fault slightly blurred (a second student's report), and the working
projector (after). For the live demo only; not evaluated.

## 7. Synthetic campus and demo history

3 buildings × 2 floors × 6 rooms = 36 rooms; 12 equipment records (including look-alike
projectors `PRJ-ENG-203` and `PRJ-ENG-204`); 6 departments; 60 labelled synthetic cases created by
`private.reset_synthetic_campus_history()`, timed relative to today, covering a repeat-failure
projector, a hard negative, a recent reopen, a long-unresolved case, an Engineering cluster and an
unknown room. They feed the heatmap and the alert rules and can be excluded with one filter.

---

## Hard questions about the data

**Why synthetic data?** There was no real, consented campus dataset, and real student reports and
photos carry personal information (faces, ID cards, phone numbers in text). Synthetic data let us
build and test every feature safely, label it exactly, and include hard cases on purpose (injection,
look-alike rooms, blurred after-photos).

**Why not real photos first?** Privacy, consent and university permission take time; and drawings
let us control each variable (blur, darkness, wrong scene). The cost: drawings are much simpler
than photos, so F1 and F4 numbers do not predict real-photo accuracy.

**Is 40 images enough?** Enough to test the pipeline and the review policy (every degraded image
went to a person), not enough for a reliable accuracy estimate: one image changes a class's recall
by up to a third.

**Can synthetic data introduce bias?** Yes. The authors wrote the reports and drew the scenes, so
the data reflects their wording and their idea of each category. Real reports will be shorter,
messier, multilingual and less evenly spread across categories.

**Are the scores reliable?** They are honest measurements of these sets on these days with these
model versions. They are small samples, single runs (two for F4), on a model that can change.
Treat them as evidence the design works, not as production accuracy.

**What about unseen real complaints?** Unknown until measured. The safety design limits the damage:
anything unclear goes to a person.

**Why a foundation model?** See [document 7, section 5](07-ai-ml-nlp-agentic-ai-concepts.md#5-why-use-an-existing-model-instead-of-training-one).

**How do you prevent evaluation leakage?** Routing: tuned only on 90 dev items; the 30 eval items
were scored twice in total (v1 and v3). Duplicates: threshold chosen on even pairs, reported on odd
pairs, and the weights were not re-tuned after seeing misses. Visual and repair prompts were not
tuned on their sets. Remaining risk: the same people wrote the prompts and the data.

**What is our original contribution?** The system design and its evidence: saved-first AI,
policy-plus-database double checks, reports vs cases with linking, a durable job queue with
attempt tokens, the cautious review policies, the six labelled datasets and reproducible
evaluation scripts that run the production code path.

**Could this become a research paper?** Possibly, with real data. A credible paper would collect a
consented real dataset (reports and photos) from one campus, compare the bounded agent against a
classic classifier and against no-AI routing on time-to-assignment and error rate, and study the
false-acceptance rate of photo-based repair verification. The current synthetic results are a
pilot, not publishable findings on their own.

**How would a real dataset improve this?** Real accuracy numbers, real duplicate rates, calibrated
alert thresholds, and data to decide whether fine-tuning or a cheaper classifier would be better.
