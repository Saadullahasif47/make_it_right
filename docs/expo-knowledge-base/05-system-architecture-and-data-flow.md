# 05. System architecture and data flow

## 1. The layers, in plain words

| Layer         | What it is                                                                   | Where in the code                                                         |
| ------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Frontend      | React server and client components rendered by Next.js                       | `src/app/**/page.tsx`, `src/components`, `src/features/*/components`      |
| Backend       | Server actions and API route handlers that call feature "use cases"          | `src/app/api/**/route.ts`, `src/features/*/{actions,service,api}.ts`      |
| Rules         | SQL functions, constraints, triggers and RLS policies                        | `supabase/migrations/*.sql`                                               |
| AI (sync)     | The routing agent, inside the submit request                                 | `src/features/agent/`                                                     |
| AI (async)    | The background worker: photos, embeddings, matching, coordinator, repair     | `supabase/functions/makeitright-ai-worker`, `supabase/functions/_shared/` |
| Scheduling    | pg_cron jobs calling the worker and refreshing insights                      | migrations `ai_jobs_and_evidence_storage`, `heatmap_and_insights`         |
| Configuration | Zod-validated environment, feature switches                                  | `src/lib/config/`                                                         |
| Security      | Session check per page, RLS, grants, privileged client confined to the agent | `src/features/auth/session.ts`, `src/lib/supabase/`                       |

The rule that holds the design together: **pages and routes orchestrate; SQL decides.** The app
never writes a table directly; it calls audited functions that check the caller and the rules.

## 2. High-level architecture

```mermaid
flowchart TB
  subgraph Users
    ST[Student]
    DS[Department staff]
    AD[Administrator]
  end

  subgraph Vercel["Vercel: Next.js 16"]
    PG[Pages: server components]
    SA[Server actions]
    API[API routes /api/*]
    UC[Use cases: src/features]
    AG[Routing agent: src/features/agent]
  end

  subgraph Supabase
    AU[Auth]
    DB[(PostgreSQL 17<br/>RLS + SQL functions)]
    Q[[pgmq queue makeitright_ai_jobs]]
    CR[pg_cron]
    ST2[(Storage: complaint-evidence, private)]
    WK[Edge Function: makeitright-ai-worker]
  end

  GM[Google Gemini API]

  ST --> PG
  DS --> PG
  AD --> PG
  PG --> SA --> UC
  API --> UC
  UC -->|user token, RLS| DB
  UC --> AG
  AG -->|tool calls| GM
  AG -->|service role: agent_begin_run / agent_finish_run| DB
  ST -->|signed URL, direct upload| ST2
  DB --- Q
  CR -->|pg_net, when work is pending| WK
  WK -->|claim, save, complete| DB
  WK --> ST2
  WK --> GM
  PG --> AU
```

## 3. What happens when a student clicks "Submit"

Traced through the actual code:

1. **Browser.** `complaint-form.tsx` posts the form (title, description, building, room, and a
   hidden idempotency key rendered once by the server).
2. **Server action.** [`src/features/complaints/actions.ts`](../../src/features/complaints/actions.ts)
   creates a Supabase client with the user's session and calls `submitComplaint` with two
   dependencies: `triage` and `afterCreate` (the duplicate check).
3. **Authentication.** The client verifies the session; `requirePageAccess` already confirmed the
   student role. (`POST /api/complaints` goes through the same use case, plus JSON-only, 16 KB cap
   and a cross-site check.)
4. **Validation.** Zod `strictObject` checks every field.
5. **Durable write.** [`repository.ts`](../../src/features/complaints/repository.ts) calls
   `rpc("create_ticket")`. In **one transaction** the SQL function: takes a per-user advisory lock,
   checks the rate limit (20 per 10 minutes) and the idempotency key, inserts the complaint,
   the key and the `created` event; triggers open a maintenance case and link the report.
6. **AI routing.** `triageTicket` ([`triage.ts`](../../src/features/agent/triage.ts)):
   `agent_begin_run` → Gemini → policy → `agent_finish_run` (assign or review) → keyword fallback
   if needed. It never throws; a failure leaves the stored ticket as it is.
7. **After create.** If duplicate detection is on,
   [`enqueue.ts`](../../src/features/duplicate-detection/enqueue.ts) calls
   `request_duplicate_check`, which writes an `ai_jobs` row and a pgmq message.
8. **Response.** Redirect to the report page with "We have your report" and the reference.
9. **Later (async).** Within about a minute, pg_cron sees pending work and calls the worker, which
   embeds the report and looks for duplicates.

```mermaid
sequenceDiagram
  autonumber
  actor S as Student
  participant F as Form (browser)
  participant A as Server action
  participant U as submitComplaint
  participant DB as PostgreSQL
  participant T as triageTicket
  participant G as Gemini
  participant Q as pgmq

  S->>F: Fill in and click Submit
  F->>A: POST form + idempotency key
  A->>U: validate (Zod)
  U->>DB: rpc create_ticket()
  Note over DB: one transaction:<br/>lock, rate limit, key check,<br/>complaint + key + created event,<br/>case + case_reports (trigger)
  DB-->>U: ticket (created or replayed)
  U->>T: triage(ticketId)
  T->>DB: agent_begin_run (service role)
  T->>G: report (sanitised) + 4 tools
  G-->>T: propose_assignment(...)
  T->>T: Zod + policy check
  T->>DB: agent_finish_run (re-checks rules)
  DB-->>T: assigned or needs_review
  U->>DB: request_duplicate_check (if F2 on)
  DB->>Q: job message (same transaction)
  A-->>S: report page, MIR-…
```

If Gemini fails in step 6, the ticket is already saved; it goes to `needs_review` (or is routed by
the backup model or keyword rules). If step 5 fails, the student sees "We could not save this
right now. Nothing was lost: please try again", and their text stays in the form (failure drill 3).

## 4. AI visual inspection sequence

```mermaid
sequenceDiagram
  autonumber
  actor S as Reporter
  participant B as Browser
  participant API as /api/complaints/[id]/photos
  participant DB as PostgreSQL
  participant ST as Storage (private)
  participant CR as pg_cron
  participant W as Worker
  participant G as Gemini

  S->>B: Add a photo
  B->>API: POST (type, size)
  API->>DB: request_evidence_upload → pending row
  API->>ST: create signed upload URL (user token)
  API-->>B: upload URL
  B->>ST: PUT image directly
  B->>API: POST /finalize
  API->>ST: download, check size, magic bytes, SHA-256
  API->>DB: finalize_evidence_upload → finalized + ai_jobs + queue message
  CR->>W: invoke (work pending)
  W->>DB: worker_claim_ai_jobs (attempt + 1)
  W->>ST: download, re-check bytes
  W->>G: image + sanitised report + JSON schema
  G-->>W: structured JSON
  W->>W: Zod validation + review policy (flags)
  W->>DB: worker_save_visual_analysis (attempt token)
  W->>DB: worker_complete_ai_job
  B->>API: page re-reads every 8 s
  API-->>S: AI observation card
```

## 5. Duplicate detection sequence

```mermaid
sequenceDiagram
  autonumber
  participant App as submitComplaint
  participant DB as PostgreSQL + pgvector
  participant W as Worker
  participant G as Gemini embeddings
  actor A as Administrator

  App->>DB: request_duplicate_check → embedding job
  W->>DB: claim embedding job
  W->>W: canonical text: title, description, category, identifiers redacted
  W->>G: embed (gemini-embedding-2, 768 dims)
  G-->>W: vector
  W->>DB: save vector + text hash → queues duplicate_match (same transaction)
  W->>DB: claim duplicate_match
  W->>DB: worker_duplicate_features: open cases, same building, last 30 days,<br/>best cosine similarity, same room / category / equipment
  W->>W: score = 0.6 sim + 0.2 room + 0.1 category + 0.1 equipment
  W->>DB: save up to 5 candidates with score ≥ 0.82
  A->>DB: review_match_candidate(accept, case version)
  Note over DB: one transaction: move report, merge old case,<br/>supersede other candidates, timeline events
```

## 6. Coordination agent workflow

```mermaid
flowchart TD
  R[Admin or holding department:<br/>Ask the coordinator] --> J[request_case_coordination<br/>job with target_version<br/>max 5 per case per day]
  J --> C[Worker claims job]
  C --> L{Model turn<br/>max 6 turns, 4 reads}
  L -->|read tool| V{Name allowed?<br/>Args valid?<br/>In scope?}
  V -->|no| X[Refuse, count as unauthorised,<br/>tell the model] --> L
  V -->|yes| RD[Run scoped SQL read<br/>ids, counts, categories] --> L
  L -->|request_admin_review| RV[Run: review_requested]
  L -->|propose_work_order| RT{Approved route<br/>for the category?}
  RT -->|no| X2[Refuse, name the right one] --> L
  RT -->|yes| P[Deterministic policy:<br/>HIGH_PRIORITY, SAFETY_SIGNAL,<br/>REPEAT_FAILURE, DEPARTMENT_OVERLOADED,<br/>REASSIGNMENT, CATEGORY_CHANGE, SHARED_CASE]
  L -->|budget used up| SL[STEP_LIMIT → review]
  P --> F[worker_finish_coordination<br/>re-checks route and version]
  F -->|case changed| SUP[superseded]
  F -->|no reasons| COM[committed: work order source coordinator]
  F -->|any reason| PEN[pending proposal]
  PEN --> AD{Admin decides}
  AD -->|approve, same version| COM2[committed: admin_approved]
  AD -->|reject| REJ[rejected]
  AD -->|case changed| STA[stale]
```

## 7. Repair verification flow

```mermaid
flowchart TD
  A[Staff: Add an after photo] --> U[Reserve → direct upload → byte check → finalize]
  U --> O[Open verification_reviews row<br/>queue repair_verify]
  O --> B{Before photo exists?}
  B -->|no| NC[not_comparable, no model call]
  B -->|yes| W[Worker re-checks both photos]
  W --> G[Gemini: both images, verify-v1, JSON schema]
  G --> V{functional_test_not_performed = true<br/>and schema valid?}
  V -->|no| INV[INVALID_OUTPUT → review]
  V -->|yes| P[Caution policy can only lower:<br/>different scene → not_comparable<br/>blurry/dark → inconclusive<br/>overclaim → inconclusive]
  P --> S[Save suggestion. No status change]
  S --> D{Person decides}
  D -->|Reporter: Yes, it is fixed| C[Ticket closed → review confirmed]
  D -->|Reporter: still a problem| R[Ticket reopened → review rework<br/>photos kept, new after photo allowed]
  D -->|Admin decision| CA[Leads the whole shared case]
```

## 8. Database entity relationships (core)

```mermaid
erDiagram
  profiles ||--o{ complaints : "created_by"
  departments ||--o{ profiles : "staff of"
  departments ||--o{ complaints : "assigned"
  complaints ||--o{ ticket_events : "history"
  complaints ||--|| submission_keys : "idempotency"
  complaints ||--o{ agent_runs : "AI routing attempts"
  departments ||--o{ routing_rules : "default for category"
  complaints ||--|| case_reports : "belongs to"
  maintenance_cases ||--o{ case_reports : "groups"
  maintenance_cases ||--o{ case_events : "history"
  maintenance_locations ||--o{ maintenance_cases : "room"
  maintenance_locations ||--o{ asset_registry : "equipment in room"
  asset_registry ||--o{ maintenance_cases : "equipment"
  complaints ||--o{ evidence_attachments : "reporter photos"
  maintenance_cases ||--o{ evidence_attachments : "repair photos"
  evidence_attachments ||--o{ visual_analyses : "AI analysis"
  visual_analyses ||--o{ visual_analysis_reviews : "human responses"
  complaints ||--o| complaint_embeddings : "vector"
  complaints ||--o{ match_candidates : "suggested duplicates"
  maintenance_cases ||--o{ match_candidates : "candidate case"
  maintenance_cases ||--o{ case_work_orders : "work orders"
  maintenance_cases ||--o{ coordination_runs : "coordinator runs"
  coordination_runs ||--o| work_order_proposals : "proposal"
  maintenance_cases ||--o{ repair_evidence : "before/after"
  maintenance_cases ||--o{ verification_reviews : "repair checks"
  asset_registry ||--o{ maintenance_alerts : "subject (repeat failure)"
  maintenance_locations ||--o{ maintenance_alerts : "subject (location)"
  maintenance_alerts ||--o{ maintenance_alert_events : "history"
```

Not shown: `ai_jobs` (referenced by analyses, runs and reviews), `config_changes`,
`maintenance_sla_policies`. An alert lists its evidence cases in a `case_ids` array, not a foreign
key. Full table descriptions in [document 6](06-database-design.md).

## 9. Deployment architecture

```mermaid
flowchart LR
  DEV[Developer laptop<br/>Docker: local Supabase] -->|git push branch| GH[GitHub]
  GH -->|pull request| CI[GitHub Actions<br/>lint, types, unit, pgTAP,<br/>integration, build, E2E]
  GH -->|every push| VP[Vercel Preview deployment<br/>FEATURE_* on]
  GH -->|merge to main| VPR[Vercel Production<br/>makeitright-takeasy1.vercel.app<br/>FEATURE_* off]
  VP --> SB[(Supabase project<br/>makeitright-staging<br/>shared by preview and production)]
  VPR --> SB
  DEV -->|supabase db push, reviewed| SB
  DEV -->|supabase functions deploy| EF[Edge Function worker]
  SB --- EF
  EF --> GM[Gemini API]
  VP --> GM
  VPR --> GM
```

Key facts:

- **One Supabase project for preview and production** (free plan limit), with only fictional data
  ([ADR 0007](../adr/0007-production-release.md)).
- Migrations are forward-only and additive; they are applied to the cloud by hand after review,
  never by CI.
- Feature switches are Vercel environment variables; changing one needs a redeploy.
- Secrets: `SUPABASE_SECRET_KEY`, `GEMINI_API_KEY` on Vercel (Sensitive); `AI_WORKER_SECRET`,
  `GEMINI_API_KEY`, `AI_ENABLED`, `GEMINI_MODEL` as Edge Function secrets; worker URL and secret
  in Vault.

## 10. Source map

| Component                     | Location                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| Submit use case               | `src/features/complaints/service.ts`                                                    |
| Ticket repository (RPC calls) | `src/features/complaints/repository.ts`                                                 |
| Routing agent                 | `src/features/agent/{triage,run-agent,gemini,policy,safety,sanitize,keyword-router}.ts` |
| Session and access            | `src/features/auth/session.ts`, `src/proxy.ts`                                          |
| Config and feature switches   | `src/lib/config/server-config.ts`                                                       |
| Photo upload                  | `src/features/evidence/`, `src/app/api/complaints/[id]/photos/`                         |
| Worker entry                  | `supabase/functions/makeitright-ai-worker/index.ts`                                     |
| Worker jobs and retries       | `supabase/functions/_shared/jobs/`                                                      |
| Vision                        | `supabase/functions/_shared/visual-inspection/`                                         |
| Duplicates                    | `supabase/functions/_shared/duplicates/`, `src/features/duplicate-detection/`           |
| Coordinator                   | `supabase/functions/_shared/coordination/`, `src/features/coordination/`                |
| Repair verification           | `supabase/functions/_shared/repair-verification/`, `src/features/repair-verification/`  |
| Heatmap and insights          | `src/features/heatmap/`, `src/features/insights/`                                       |
| Schema and rules              | `supabase/migrations/` (15 files)                                                       |
