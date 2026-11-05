# Evidence: Add-on phase A3, F2 duplicate detection

**Gate A3 (plan v2 §14, §07):** all original report history survives linking; manual case
creation works when embeddings fail.

Design decisions: [ADR 0011](../adr/0011-duplicate-detection-and-shared-cases.md). Evaluation:
[a3-duplicate-eval.md](a3-duplicate-eval.md).

## Task checklist

| ID    | Task                                                             | Status | Evidence                                                                                                                |
| ----- | ---------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| A3.01 | 768-dimension embedding jobs; model version and content hash     | Done   | `complaint_embeddings` (`vector(768)`, model, `text_hash`); `embedding` handler skips unchanged text                    |
| A3.02 | Scoped candidate retrieval, ranker, `match_candidates` review UI | Done   | `worker_duplicate_features` (same building, 30 days, open, same model); `ranking.ts`; admin "Possible duplicates" panel |
| A3.03 | Case link transaction, version checks, audit                     | Done   | `review_match_candidate`; shared cases lead their reports                                                               |
| A3.04 | Evaluate 60 labelled pairs; choose a threshold                   | Done   | Threshold **0.82**; held-out P 1.00, R 0.80, F1 0.889                                                                   |

Also covered:

- **F2.01:** pgvector and exact cosine search.
- **F2.02:** hash skip.
- **F2.03:** ranker labelled "candidate, not fact".
- **F2.04:** Accept / Reject / Keep separate.
- **F2.05:** atomic link with status propagation.
- **F2.06:** the evaluation.
- **§12:** `GET /api/complaints/[id]/match-candidates` and `POST /api/complaints/[id]/match-review`.

## Verify clauses, as tested

| Plan clause                                                             | How it was shown                                                                                                                                                                                          |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No mixed-version vectors (A3.01, F2.01)                                 | pgTAP: a candidate case whose vector has another model is not returned. Unit: a model change re-embeds. Integration: stored vectors carry `gemini-embedding-2` and 768 dimensions                         |
| Same content and model make no repeated remote call (F2.02)             | Unit: unchanged hash and model give no provider call (the stored vector is reused). pgTAP: reuse returns the same match job                                                                               |
| False match not auto-merged (A3.02)                                     | Integration and E2E: a candidate leaves both reports in separate cases until an admin decides                                                                                                             |
| Two unrelated issues in the same room are not grouped (F2.03)           | Integration: a light fault in the same room is not proposed. Unit: the room alone never reaches the threshold. Eval: 12/12 same-room different-problem pairs stay below it                                |
| Reject leaves both cases unchanged; accept links atomically (F2.04)     | Integration (reject: separate cases, no merge, no re-decision) and E2E (desktop and phone). pgTAP: accept moves the report, keeps the old case as `merged`, writes events and supersedes other candidates |
| Each complaint belongs to at most one active case; audit exists (F2.05) | `case_reports` primary key. pgTAP: a report already sharing a case cannot be moved again (`MR422`). Events on both cases and the ticket                                                                   |
| One complaint links to one active case (A3.03)                          | As above, plus the stale-version refusal (`MR412`). Mutation check: disabling it fails the integration test                                                                                               |
| Threshold documented, with false-positive examples (F2.06, A3.04)       | [a3-duplicate-eval.md](a3-duplicate-eval.md): sweep table, similarity by kind, confusion cases                                                                                                            |
| All original report history survives linking (gate)                     | Integration: both complaint rows and their timelines remain; the reporter's timeline gains `case_linked`; each reporter still sees only their own report                                                  |
| Manual case creation works when embeddings fail (gate)                  | Integration: `STUB:EMBED-REJECT` puts the job in review (`PROVIDER_REJECTED`); the report keeps its case and the admin routes it normally                                                                 |

Shared-case behaviour (ADR 0011 §7–9) was exercised end to end in one integration test:

1. link;
2. admin assigns report 1, and report 2 is assigned too;
3. the department starts work on report 2, and report 1 moves too;
4. the department resolves report 1, and report 2 moves too;
5. reporter 1 closes their report, but report 2 and the case stay `resolved`;
6. reporter 2 closes their report, and the case closes.

## Live evaluation (synthetic pairs, 2026-11-05, `gemini-embedding-2`)

| Set                                | Precision | Recall    | F1        |
| ---------------------------------- | --------- | --------- | --------- |
| Tuning half (even pairs)           | 1.000     | 0.867     | 0.929     |
| **Held-out half (odd pairs)**      | **1.000** | **0.800** | **0.889** |
| All 60                             | 1.000     | 0.833     | 0.909     |
| All 60 at the first default (0.55) | 0.492     | 0.967     | 0.652     |

Honest reading:

- With this model, even unrelated campus reports are fairly similar (cosine 0.73–0.93), which is
  why 0.55 proposed nearly everything.
- All five misses are duplicates with no shared room. The plan's formula cannot reach 0.82
  without the same-room bonus; this is recorded as a limitation and not re-tuned on the same set.
- The evaluation also exposed a product gap: with AI routing off, every report is unclassified,
  so a strict category match blocked all candidates. Category is now "compatible" when either
  report is unclassified (ADR 0011 §3).

## Screenshots (local preview, both duplicate and photo features on, AI routing off)

| View                                                                              | File                                              |
| --------------------------------------------------------------------------------- | ------------------------------------------------- |
| Admin: a candidate with its evidence (98% similar wording, same room, score 0.89) | [admin-candidate.jpg](a3/admin-candidate.jpg)     |
| Admin: after "Same problem: link" (page notice, shared case listing both reports) | [admin-linked.jpg](a3/admin-linked.jpg)           |
| Admin: panel moved above routing; the timeline shows "Linked with other reports"  | [admin-shared-case.jpg](a3/admin-shared-case.jpg) |

The preview led to three fixes, each re-checked:

- The panel moved above the routing form, because linking can carry routing over.
- An icon no longer shrinks in the narrow column.
- The confirmation became a page notice, because the panel changes shape after a decision.

The console had no errors.

## Local verification

Run on 2026-11-05 on `phase/a3-duplicate-detection` after `supabase db reset`. The first E2E
server has every flag OFF; the second has the photo and duplicate features on.

| Suite                        | Result                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `pnpm lint`                  | Pass, 0 warnings                                                             |
| `pnpm typecheck` (tsc)       | Pass                                                                         |
| `pnpm format:check`          | Pass                                                                         |
| `pnpm test` (unit + DOM)     | **532 / 532** (16 new: ranking, canonical text, embedding adapter, handlers) |
| `pnpm db:test` (pgTAP)       | **453 / 453** in 11 files (30 new in `011_duplicate_detection`)              |
| `pnpm test:integration`      | **126 / 126** (7 new: real worker + stub, linking, shared-case sync)         |
| `pnpm build`                 | Pass                                                                         |
| `pnpm test:e2e` (Playwright) | **213 passed**, 7 skipped by design (desktop-only or phone-only), 0 failed   |

New E2E journeys (`duplicates.spec.ts`), on desktop Chromium and Pixel 7:

- two students report the same leak through the real form, and an admin links them (axe clean);
- an admin marks a candidate as a different problem;
- with the flag OFF there is no panel, no API (404) and no job.

**First gate attempt.** Six E2E tests failed:

- Four were duplicate journeys, where the worker answered HTTP 546. The local Edge runtime's
  `per_worker` policy reuses one isolate, and its CPU time accumulated across the suite's
  parallel calls until the supervisor cancelled requests ("CPU time hard limit reached").
- Two were sign-up and password-reset journeys, where local auth timed out sending email (504)
  under the same load.

The local policy is now `oneshot` (a fresh isolate and CPU budget per request, as on the hosted
platform). After that change the full suite passed with 0 failures, and the runtime logged no
cancellations. Unit, pgTAP, integration, lint, typecheck, format and build had all passed in the
first attempt.

## Not yet verified

- **Cloud.** Nothing is pushed (migrations, worker, `GEMINI_EMBEDDING_MODEL`); the plan
  schedules this for A7.03 with the owner's approval. With the flag OFF, production is unchanged.
- **Real reports.** The evaluation used 60 written pairs.
- **Unlinking** a wrongly linked report is not built (ADR 0011).
