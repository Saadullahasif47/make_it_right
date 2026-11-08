# 15. Quick revision cheatsheet

## Pitch

> "MakeItRight lets students report campus problems in a minute and track them until they confirm
> the fix. AI routes routine reports, describes photos, finds duplicates and compares repair
> photos, but it only suggests: rules, the database and people decide. Nothing is lost if the AI
> fails."

## Workflow in one line

Report → **saved first** (one transaction) → AI proposes route → code policy + SQL re-check →
assigned or review → staff acknowledge, start, resolve (with note) → **reporter** confirms or
reopens → closed. Add-ons: photo analysis, duplicate linking into a shared case, coordinator
work orders, before/after check, heatmap and alerts.

## Statuses

`submitted → triaging → assigned → in_progress → resolved → closed`, plus `needs_review` and
`reopened`. Staff cannot close; the reporter (or an admin) closes.

## Technologies and why

| Technology                                      | Why                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| Next.js 16 + React 19 + TypeScript strict       | One deployable for UI and API; server components; type safety          |
| Tailwind CSS 4                                  | Full control, no component kit, accessible tokens                      |
| Zod                                             | Validates every input, config value and AI output                      |
| Supabase PostgreSQL 17 + RLS                    | Transactions, constraints, aggregation; access control in the database |
| Supabase Auth                                   | Email/password, HttpOnly cookies                                       |
| Supabase Storage                                | Private photos, direct upload, signed URLs                             |
| pgmq + pg_cron + pg_net + Vault                 | Transactional job queue; scheduled worker calls; secrets               |
| Edge Function (Deno)                            | Background AI worker near the data                                     |
| pgvector                                        | Embeddings and cosine similarity in SQL                                |
| Gemini 3.1 Flash-Lite / 3.5 Flash / Embedding 2 | Text, images, tools, JSON output, embeddings; free tier                |
| Vercel                                          | Serverless hosting, previews, instant rollback                         |
| GitHub Actions                                  | Full test pipeline on every PR                                         |
| Vitest, pgTAP, Playwright + axe                 | Unit, database, end-to-end and accessibility tests                     |

Not used: shadcn/ui, Recharts, ORMs, Realtime, LangChain, self-trained models.

## AI features at a glance

| Feature                 | Model                       | Who decides                   | Key safety point                                        |
| ----------------------- | --------------------------- | ----------------------------- | ------------------------------------------------------- |
| Routing                 | Flash-Lite (+ Flash backup) | Policy + SQL; admin if unsure | 4 tools, none writes; high priority/safety → person     |
| F1 Photo                | Flash-Lite (vision)         | Reporter/admin respond        | Says what it can't see; code decides review             |
| F2 Duplicates           | Embedding 2 (768-d)         | Admin                         | Score = 0.6 sim + 0.2 room + 0.1 cat + 0.1 equip ≥ 0.82 |
| F3 Coordinator          | Flash-Lite, tool loop       | Rule policy, then admin       | 6 tools, none writes; 7 approval reasons                |
| F4 Repair check         | Flash-Lite, two images      | Reporter/admin                | Must say "no functional test"; never closes             |
| F5/F6 Heatmap, insights | None (SQL)                  | Admin                         | Distinct cases; rules, not predictions                  |

## Results to remember

| What                           | Number                                                                 |
| ------------------------------ | ---------------------------------------------------------------------- |
| Routing (30 held-out)          | macro-F1 **0.981**; 25/25 routed correctly; 3/3 safety held; p95 4.1 s |
| Photo (40 drawings)            | macro-F1 **0.735** (0.796 clear); **14/14** needing a person got one   |
| Duplicates (30 held-out pairs) | P **1.000**, R **0.800**, F1 **0.889** at 0.82                         |
| Coordinator (25 scenarios)     | **25/25**; 0 risky auto-commits                                        |
| Repair check (30 pairs)        | 23/25 and 17/21 agreement; 2–3 false acceptances                       |
| Failure drills                 | **22/22**; no report lost                                              |
| Load (local)                   | 0 errors; p95 ≤ 227 ms at 20 concurrent                                |
| Tests                          | 584 unit · 573 pgTAP · 151 integration · 233 E2E                       |
| Production smoke               | 27/27 on `4879ce9`                                                     |

## Limitations to say first

1. Synthetic data only; real accuracy unknown.
2. No notifications.
3. Shared free-tier database for preview and production.
4. Add-on features off on production until switched on.
5. English only; tested to 20 concurrent users.
6. Old reports aren't duplicate-matched (no backfill); no unlinking.

## Top 25 judge questions, short answers

1. **Did you train a model?** No. We use Gemini via API; we built the controls, data and evaluation.
2. **Is it just CRUD + Gemini?** The AI can't write anything; code and SQL re-check every output; a queue, RLS, idempotency and tests make it safe.
3. **What if Gemini is down?** Saved first; backup model; keyword rules; then a person. Jobs retry 3×.
4. **Why agentic?** The model picks tools in a loop until it proposes; bounded by tools and budget.
5. **Can the AI close a case?** No. Only the reporter or an admin.
6. **Wrong department?** Only the approved one for a category can be proposed; staff/admin reassign.
7. **Prompt injection?** Fenced as data, no write tools, policy and SQL checks; injection tests passed.
8. **Why synthetic data?** No consented real data; privacy; exact labels; hard cases on purpose.
9. **Is 40 images enough?** For the pipeline and review policy, yes; for accuracy, no.
10. **Embeddings?** Numbers for meaning; cosine similarity; plus room and equipment.
11. **Why 0.82?** Best F1 on 30 tuning pairs; tested on 30 held-out.
12. **What's RLS?** The database filters rows per user; the app can't bypass it.
13. **Can a student become admin?** No: sign-up is always student; role column not writable.
14. **Double submission?** Idempotency key: same ticket; 10 simultaneous → 1 ticket.
15. **Two staff at once?** Version + row lock: one wins, the other gets 409.
16. **Why a queue?** AI work is slow and can fail; the queue retries and survives crashes.
17. **Worker crashes?** Message reappears; attempt 2 succeeds; late answers refused.
18. **Cost for 10,000 students?** Not estimated; drivers are calls per report and database tier.
19. **Thousands of users?** Serverless + queue degrade gracefully; only 20 concurrent tested.
20. **Why not ServiceNow/Jira?** They're stronger on channels and support; ours fits student-first campus maintenance and is cheap.
21. **Original contribution?** The safety architecture, reports vs cases, the queue design, cautious photo policies, datasets and reproducible evaluations.
22. **Are insights ML?** No: four SQL rules with documented thresholds.
23. **Wrong duplicate link?** Admin-only, each student keeps their report; unlinking not built.
24. **Fake complaints?** Signed-in, rate-limited (20/10 min), recorded; no abuse detection yet.
25. **Next six months?** Real data pilot, notifications, SSO, Urdu, dedicated database, backfill and unlinking.

## Terms

| Term                   | Meaning                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| ADR                    | Architecture Decision Record (`docs/adr/`)                             |
| RLS                    | Row-Level Security in PostgreSQL                                       |
| RPC                    | Calling a SQL function through the API                                 |
| `SECURITY DEFINER`     | A SQL function that runs with its owner's rights, after its own checks |
| Service role           | Supabase's privileged key; only the agent and worker use it            |
| Idempotency key        | A per-form id so retries don't duplicate                               |
| Optimistic concurrency | Version check on update; stale → 409                                   |
| pgmq                   | Message queue inside PostgreSQL                                        |
| Visibility timeout     | How long a claimed message stays hidden before it can be redelivered   |
| Embedding              | Vector of numbers representing meaning                                 |
| Cosine similarity      | Angle-based closeness of two vectors                                   |
| Macro-F1               | Average F1 over classes, each counted equally                          |
| Tool calling           | The model outputs a function call; code executes it                    |
| Structured output      | The model must answer in a JSON schema                                 |
| HITL                   | Human-in-the-loop                                                      |
| Prompt injection       | Input text that tries to instruct the model                            |
| Feature switch         | `FEATURE_*` variable that shows or hides a feature                     |
| Maintenance case       | The real problem (`MC-…`); may hold several reports (`MIR-…`)          |
| p50 / p95              | Median / 95th-percentile latency                                       |
