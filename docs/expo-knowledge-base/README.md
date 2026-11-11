# MakeItRight expo knowledge base

This folder is a study guide for the people presenting MakeItRight at the PINTEC Expo (15–16
November 2026). It explains the whole system: what it does, how to operate it, how every part
works inside, why it was built this way, what was measured, and where it is weak.

Everything here was written from the repository itself: the source code, the SQL migrations, the
tests, the design records (`docs/adr/`) and the evidence reports (`docs/evidence/`). Every important
claim points to the file that backs it. Where something could not be checked, it says
**Unverified**.

Snapshot: written on 2026-11-08 against `main` at commit `4879ce9`.

## How to read the status labels

Every feature in these documents carries one of four labels.

| Label                           | Meaning                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Live**                        | Built, deployed, and switched on at <https://makeitright-takeasy1.vercel.app>.                                                                                                 |
| **Built, switched off in prod** | Built, tested, and its database and worker are in the cloud, but its `FEATURE_*` switch is off on production. It is switched on in the Vercel preview used for demo rehearsal. |
| **Verified locally**            | Proven by automated tests on the local stack (Docker), not yet exercised end to end in the cloud.                                                                              |
| **Not built**                   | Planned, suggested or deferred. Never present it as working.                                                                                                                   |

State of the cloud on 2026-11-08 (from this session's read-only checks):

- Production runs `main` (`4879ce9`); the release smoke test passed 27/27.
- The database has every migration up to A6, the seed, the AI worker and its schedule.
- The six feature switches are **on for Vercel Preview only**. The rehearsal preview is
  `makeitright-git-main-takeasy1.vercel.app`. On it, photo analysis (F1) was seen working with a
  real Gemini answer. The duplicate job and a coordinator run also completed. Repair
  verification, the heatmap and insights have not yet been rehearsed in the cloud.

## Reading order

Read in this order the first time. Documents 13 and 15 are the ones to reread on the day.

| #   | Document                                                                     | What it gives you                                                                           | Time   |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------ |
| 1   | [Project overview](01-project-overview.md)                                   | What MakeItRight is, the problem, the users, and three ready-to-speak pitches               | 15 min |
| 2   | [Complete user manual](02-complete-user-manual.md)                           | Every screen and button for students, staff and administrators, and the LAB-204 walkthrough | 45 min |
| 3   | [Feature-by-feature explanation](03-feature-by-feature-explanation.md)       | Each base feature and F1–F6 in depth: purpose, flow, internals, security, failure, limits   | 60 min |
| 4   | [Technology stack and decisions](04-technology-stack-and-decisions.md)       | Every technology actually in the repository, why it was chosen, and the alternatives        | 40 min |
| 5   | [System architecture and data flow](05-system-architecture-and-data-flow.md) | Eleven Mermaid diagrams and a code-level trace of "Submit"                                  | 40 min |
| 6   | [Database design](06-database-design.md)                                     | All 27 tables, RLS, constraints, idempotency, cases vs reports                              | 45 min |
| 7   | [AI, ML, NLP and agentic AI concepts](07-ai-ml-nlp-agentic-ai-concepts.md)   | The concepts behind the AI, and the honest answer to "did you train a model?"               | 45 min |
| 8   | [Datasets and evaluations](08-datasets-and-evaluations.md)                   | The six evaluation sets and the demo campus: contents, method, results, limits              | 40 min |
| 9   | [Security, reliability and testing](09-security-reliability-and-testing.md)  | Every protection that exists, and what each test layer proves                               | 35 min |
| 10  | [Existing systems comparison](10-existing-systems-comparison.md)             | A fair comparison with Jira Service Management, Freshservice and ServiceNow                 | 20 min |
| 11  | [121 expo judge questions](11-expo-judges-100-questions.md)                  | Hard questions with spoken answers, technical depth, evidence and limits                    | 90 min |
| 12  | [Future improvements](12-future-improvements.md)                             | Realistic next steps, ranked                                                                | 20 min |
| 13  | [Six-minute expo demo](13-six-minute-expo-demo.md)                           | Minute-by-minute demo, scripts, backups and checklists                                      | 30 min |
| 14  | [Critical project review](14-critical-project-review.md)                     | An independent reviewer's ranked weaknesses and how to talk about them                      | 25 min |
| 15  | [Quick revision cheatsheet](15-quick-revision-cheatsheet.md)                 | Everything important on a few pages, plus the top 25 questions                              | 15 min |

## Corrections found while writing

Writing this guide meant checking older documents against the code. These differences were found.
None of them changes how the system behaves.

1. **The repository README is out of date.** It still says photo evidence is deferred, lists
   older test counts (382 unit, 222 pgTAP, 80 integration, 151 E2E) and does not mention the six
   add-on features. Current counts are in [document 9](09-security-reliability-and-testing.md).
2. **"Three tools".** The landing page and the README say the triage model has three tools. The
   code declares four: two read-only lookups (`list_departments`, `find_category_route`) and two
   final actions (`propose_assignment`, `request_human_review`), in
   [`src/features/agent/prompt.ts`](../../src/features/agent/prompt.ts). Say "four tools, two of
   them read-only lookups, none of them writes".
3. **The expo asset ZIP's README** said the visual inspection set has 30 images. It has **40**
   (`tests/eval/visual/dataset.json`). The ZIP's README was corrected.
4. **Model names on screen.** ADRs 0010, 0012 and 0013 say the result cards show the model and
   prompt version. Since PR #31 (2026-11-08) the screens no longer show them; the database still
   stores both on every result.
5. **Duplicate detection only sees reports made while it was switched on.** A report submitted
   before `FEATURE_DUPLICATE_DETECTION` was on has no embedding, so later reports cannot match
   it. Found during the cloud rehearsal on 2026-11-08 (MIR-1020 had no embedding). There is no
   backfill yet. See [document 14](14-critical-project-review.md).

## What this folder does not do

It changes no code, schema, secret, switch or deployment. The numbers come from the evidence
reports already in the repository; no new evaluation was run for these documents.
