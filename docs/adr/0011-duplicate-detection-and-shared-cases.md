# ADR 0011: Duplicate detection and shared cases

- **Status:** Accepted
- **Date:** 2026-11-05
- **Phase:** A3 (Advanced Features add-on, F2)

## Context

Plan v2 §07 (F2.01–F2.06) and phase A3 ask for:

- semantic duplicate candidates that a person accepts or rejects;
- an atomic, version-checked link that never erases a report;
- one case per complaint;
- a threshold chosen on 60 labelled pairs.

ADR 0008 left a second job to A3: once a case holds several reports, the case must lead them.

**Gate A3:** all original report history survives linking, and manual case creation still works
when embeddings fail.

## Decisions

### Finding candidates

1. **Two queued jobs per report.**
   - The app queues `embedding` after a new report is saved and triaged, while
     `FEATURE_DUPLICATE_DETECTION` is on. The step is best effort and can never fail the
     submission.
   - The embedding handler embeds a canonical text (title, description and category, with
     identifiers redacted by the triage sanitiser) using `gemini-embedding-2` at 768 dimensions.
     It stores the vector with its model and a SHA-256 of the text; text and model that have
     not changed are never sent again.
   - Storing the vector queues `duplicate_match` in the same transaction.
2. **The database finds the candidates.** `worker_duplicate_features` returns open, unmerged
   cases opened in the last 30 days in the same building, matched by location or by the reports'
   building text. Each comes with:
   - its exact pgvector cosine similarity, taken as the best over the case's reports and only
     against vectors of the same model;
   - same room, compatible category and same equipment.

   Vectors of different models are never compared; re-embedding happens when the model changes.

3. **The worker ranks** with the plan's formula: 0.6 × similarity + 0.2 × same room
   - 0.1 × compatible category + 0.1 × same equipment. It keeps at most 5 candidates at or above
     **0.82**, the threshold chosen in A3.04.
   * The formula lives once in `_shared/duplicates/ranking.ts`, used by both the worker and the
     evaluation.
   * A category is "compatible" when both match or either is still unclassified. The evaluation
     showed why: with AI routing off, every report is unclassified, so a strict match could never
     let a duplicate reach the threshold. An unknown category is no evidence of a different
     problem, and a person reviews every candidate anyway.
4. **Candidates are suggestions, never facts.** `match_candidates` stores the features and the
   score. One row per pair, so a rejected pair stays rejected when the match runs again.
   - Admins see every candidate; the assigned department sees those for its own report; students
     see none.
   - Embeddings are readable by no API role at all.

### Deciding and linking

5. **Only an administrator decides** (`review_match_candidate`).
   - **Reject** marks the candidate and changes nothing else.
   - **Accept** checks that the candidate case is still open and still at the version the admin
     saw (otherwise `MR412`, HTTP 409), and that the report does not already share a case. Then,
     in one transaction:
     - the report's `case_reports` row moves to the candidate case and records the decision;
     - the report's own one-report case becomes `merged`, with `merged_into_case_id` and an
       event, so its history stays readable;
     - the target case records `report_linked`;
     - the report's other pending candidates become `superseded`;
     - the report's ticket gets a `case_linked` event ("Linked with other reports"). Each
       reporter keeps their own report page.

   "Keep as a separate case" rejects every pending candidate at once.

6. **Routing carries over sensibly.** If the target case was never routed but the new report
   was, the case adopts the report's routing; otherwise the report follows the case. Either
   way, every linked ticket ends up consistent with the case.

### Shared cases lead their reports (replaces the A0 placeholder)

7. **A staff, admin or agent change on any linked ticket leads the case.** The change (status,
   department, category, priority) goes through the existing audited ticket functions, as before.
   The mirror trigger then:
   - updates the case;
   - applies the change to every other open ticket in it, as a system event ("Updated with the
     shared case MC-…"), under a transaction-local flag that stops the trigger from recursing.
8. **Reporters stay in charge of their own confirmation.**
   - When a reporter closes their own ticket (confirming the fix), only that ticket closes. The
     case closes when its last report is closed.
   - A reporter's dispute (reopening) reopens the shared work and the other reports that were
     resolved.
   - A ticket its reporter has closed is never changed again by its case.
9. **Synced siblings skip the transition table.** It describes what a person may do to a ticket;
   copying the case's state is not such an action. Every change is still an append-only event,
   and every version still bumps, so a stale page gets the usual 409.

### Evaluation (A3.04, F2.06)

10. **60 labelled synthetic pairs** (`tests/eval/duplicates/pairs.json`):
    - 30 duplicates;
    - 30 hard negatives: same room with a different problem, the same kind of fault in the same
      room, and the same kind of problem in a different room.

    `pnpm eval:duplicates` embeds them with the live model. The threshold is chosen on the even
    pairs (best F1) and reported on the odd pairs. Results are in
    `docs/evidence/a3-duplicate-eval.md`: held-out precision 1.00, recall 0.80, F1 0.889.

11. **Known limitation, recorded and not tuned away.** All five missed duplicates are reports
    whose room is unknown or shared (library roof, lift, stairs). Without the same-room bonus,
    the plan's weights cannot reach 0.82. Re-weighting on the same 60 pairs would only overfit
    them, so it waits for real data. Those reports still get their own case, and an admin can
    route them by hand.

## Consequences

- Each report costs one embedding call (none if unchanged) and one SQL ranking query. The match
  job runs in the same worker invocation as the embedding when the queue is free.
- Unlinking a report from a shared case is not built; a wrong link needs a corrective migration
  or a support action. Accepting therefore shows the candidate's reports and evidence first and
  is admin-only.
- The local Edge runtime now runs `oneshot` (a fresh isolate per request). With `per_worker`,
  CPU time accumulated across requests in one isolate, and parallel E2E runs hit the hard limit
  (HTTP 546). Hosted Edge Functions budget CPU per request. A run cut short is safe anyway: its
  claimed job reappears after the visibility timeout (ADR 0009).
- Deploying adds `GEMINI_EMBEDDING_MODEL` (optional; it defaults to `gemini-embedding-2`) to the
  worker's secrets, in A7.03.
