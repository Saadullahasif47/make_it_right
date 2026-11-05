# Evidence: A3 duplicate detection evaluation (synthetic pairs)

> **Synthetic scenario evaluation.** 60 fictional report pairs written for this test
> (`tests/eval/duplicates/pairs.json`): 30 duplicates and 30 hard negatives. The numbers
> describe this set only, not real campus reports.

- Run: 2026-11-05, embedding model `gemini-embedding-2` at 768 dimensions
- Code path: the worker's canonical text, embedding adapter and ranking formula
  (0.6 × similarity + 0.2 × same room + 0.1 × same category + 0.1 × same equipment)
- Threshold chosen on the 30 even-numbered pairs (best F1), reported on the 30 odd-numbered ones

## Results

Chosen threshold: **0.82**. A candidate is proposed for a person's review at or
above it; nothing is ever linked automatically.

| Set                                 | Precision | Recall | F1        | TP  | FP  | FN  | TN  |
| ----------------------------------- | --------- | ------ | --------- | --- | --- | --- | --- |
| Tuning half (even pairs)            | 1.000     | 0.867  | **0.929** | 13  | 0   | 2   | 15  |
| Held-out half (odd pairs)           | 1.000     | 0.800  | **0.889** | 12  | 0   | 3   | 15  |
| All 60 pairs                        | 1.000     | 0.833  | **0.909** | 25  | 0   | 5   | 30  |
| All 60 at the previous default 0.55 | 0.492     | 0.967  | **0.652** | 29  | 30  | 1   | 0   |

## Precision and recall across thresholds (all 60 pairs)

| Threshold | Precision | Recall | F1    |
| --------- | --------- | ------ | ----- |
| 0.40      | 0.500     | 1.000  | 0.667 |
| 0.45      | 0.500     | 1.000  | 0.667 |
| 0.50      | 0.500     | 1.000  | 0.667 |
| 0.55      | 0.492     | 0.967  | 0.652 |
| 0.60      | 0.492     | 0.967  | 0.652 |
| 0.65      | 0.580     | 0.967  | 0.725 |
| 0.70      | 0.714     | 0.833  | 0.769 |
| 0.75      | 0.714     | 0.833  | 0.769 |
| 0.80      | 0.862     | 0.833  | 0.847 |
| 0.85      | 1.000     | 0.600  | 0.750 |
| 0.90      | 1.000     | 0.067  | 0.125 |

## Raw similarity by kind of pair

| Pair kind                                         | Pairs | Mean cosine | Min   | Max   |
| ------------------------------------------------- | ----- | ----------- | ----- | ----- |
| duplicate: same problem, reworded                 | 25    | 0.927       | 0.875 | 0.973 |
| duplicate: same problem, room unknown             | 5     | 0.935       | 0.886 | 0.975 |
| negative: same room, different problem            | 12    | 0.765       | 0.727 | 0.827 |
| negative: same room and category, different fault | 10    | 0.820       | 0.752 | 0.866 |
| negative: same problem type, different room       | 8     | 0.896       | 0.840 | 0.932 |

## Confusion cases at 0.82

| Pair | Label              | Kind                       | Similarity | Score |
| ---- | ------------------ | -------------------------- | ---------- | ----- |
| d26  | duplicate (missed) | same problem, room unknown | 0.975      | 0.685 |
| d27  | duplicate (missed) | same problem, room unknown | 0.934      | 0.660 |
| d28  | duplicate (missed) | same problem, room unknown | 0.886      | 0.532 |
| d29  | duplicate (missed) | same problem, room unknown | 0.937      | 0.662 |
| d30  | duplicate (missed) | same problem, room unknown | 0.943      | 0.666 |

## Reading

- A false suggestion costs an administrator one "Different problem" click; it never links
  anything. A missed duplicate means two cases for one problem until someone notices. The
  threshold balances the two on the tuning half; the held-out half shows how well that carries
  over.
- 60 short synthetic pairs and one run: a single pair moves a rate by several points.
