# 11. Expo judge questions (121)

Each answer has four parts:

- **Say:** a 20–40 second spoken answer. Use your own words; don't recite.
- **Deeper:** the technical detail if they push.
- **Evidence:** where it is in the repository.
- **Limit:** the honest weakness, when there is one.

---

## A. Project justification

### A1. Why did you choose this project?

**Say:** Every student has seen a broken light or projector stay broken because nobody knew whom to tell, or everyone assumed someone else had. We wanted a system where reporting takes a minute, the right team gets it, and the student can see what happened. It also needed every part of our cloud course: hosting, a secured database, storage, queues, serverless functions and AI.
**Evidence:** [01-project-overview](01-project-overview.md).

### A2. What problem does it solve, in one sentence?

**Say:** It turns scattered, untracked maintenance complaints into routed, tracked, confirmed work, with evidence for administrators about where problems keep happening.

### A3. Who benefits most?

**Say:** Students get a reference number and a timeline. Staff get a clean queue with only their department's work. Administrators get a review queue, duplicate suggestions, and a heatmap with recurrence alerts.

### A4. Why is this useful compared with WhatsApp groups?

**Say:** A WhatsApp message has no owner, no status, and scrolls away. Here every report has an owner department, a status, a history that can't be edited, and the reporter decides when it's fixed. It also doesn't expose students' phone numbers to everyone.

### A5. What is innovative here?

**Say:** Not any single feature. It's the combination with a strict safety design: the report is saved before AI runs, AI only suggests, code checks every AI output, and the database checks it again. On top of that, reports are linked into shared cases, and photo features always say what a photo can't prove.
**Limit:** Many parts, like ticketing and AI categorisation, exist in commercial products.

### A6. Is this used at a real university?

**Say:** Not yet. It's a working prototype deployed in the cloud with fictional data only. Real use would need university sign-on, a privacy policy and real-data testing.
**Evidence:** [ADR 0007](../adr/0007-production-release.md).

### A7. What did you measure to show it works?

**Say:** We measured AI quality on six labelled synthetic datasets, load and latency, and failure drills. For example, routing scored a macro-F1 of 0.981 on 30 held-out reports, and in failure drills no report was ever lost.
**Limit:** We have no measurement of real-world impact, like faster repairs.

### A8. What would a university gain in numbers?

**Say:** We can't claim numbers yet. We'd measure time from report to assignment, time to resolution, duplicate rate and reopen rate before and after adoption. The dashboard already computes resolution time and ageing.

### A9. Why the name MakeItRight?

**Say:** It's about getting campus problems put right, and about doing it the right way: tracked, confirmed and fair to the person who reported it.

### A10. What was the hardest part?

**Say:** Making AI safe to use. Calling a model is easy; making sure a wrong or manipulated answer can never change data, lose a report or close a case took most of the design: tool limits, policies, database re-checks and tests.

---

## B. Software engineering

### B1. Describe the architecture.

**Say:** A Next.js app on Vercel handles pages and APIs. Supabase provides PostgreSQL with row-level security, authentication, private photo storage, a message queue and an Edge Function worker for background AI jobs. Gemini is the AI. Business rules live in SQL functions so every path goes through them.
**Evidence:** [05-system-architecture](05-system-architecture-and-data-flow.md).

### B2. Why a monolith and not microservices?

**Say:** One small team, one domain. A single Next.js deployable plus one worker is simpler to build, test and deploy. Microservices would add network calls and deployment overhead without a scaling need.
**Evidence:** [ADR 0001](../adr/0001-stack-and-repository-structure.md).

### B3. How are requirements traced to code?

**Say:** We worked from two master plans with numbered requirements. Each phase has an ADR explaining decisions and an evidence report showing its gate was met, and every phase was merged only when all tests passed.
**Evidence:** [progress tracker](../progress-tracker.md).

### B4. What design patterns did you use?

**Say:** Repository functions for data access, a use-case layer shared by the form and the API, dependency injection so tests can swap the model or fetch, a provider-neutral model interface (adapter), a policy object for decisions, and the transactional outbox pattern for the queue.
**Deeper:** "Outbox": the job row and its queue message are written in the same transaction as the business change.

### B5. How do the web form and the API stay consistent?

**Say:** They call the same function, `submitComplaint`, so validation, idempotency and AI steps can't diverge.
**Evidence:** `src/features/complaints/service.ts`.

### B6. How do you handle errors?

**Say:** SQL functions raise stable codes like MR412 for stale data or MR404 for not found. The server maps them to HTTP statuses and one JSON error shape with a request id. AI failures get stable codes like RATE_LIMITED or TIMEOUT.

### B7. How do you prevent lost updates?

**Say:** Every ticket has a version number. A change must say which version it saw; the database locks the row and compares. If someone changed it first, you get a 409 and a refresh link.
**Evidence:** failure drill 5 in [p6-drills](../evidence/p6-drills.md).

### B8. How maintainable is the code?

**Say:** Strict TypeScript, strict lint rules, Zod schemas shared between validation and types, features in their own folders, and about 1,500 automated tests. Every decision is in an ADR.

### B9. How would it scale to more users?

**Say:** The web tier is serverless and scales automatically. The database is the limit; we'd move to a paid Supabase tier with a dedicated production project. AI jobs are queued, so bursts wait instead of failing.
**Limit:** Load-tested only at 20 concurrent users.

### B10. Why server components?

**Say:** Data fetching and permission checks stay on the server, secrets never reach the browser, and pages are fast. Only interactive parts are client components.

### B11. How do you configure the app safely?

**Say:** Environment variables are read in one module and validated by a Zod schema at startup. A vague value like "maybe" stops the app from starting rather than guessing.

### B12. How do feature switches work?

**Say:** Six environment variables, all off by default. When off, the screens disappear and the APIs answer 404. Turning one on needs a redeploy, so a broken feature can be switched off instantly.

---

## C. Database

### C1. Why PostgreSQL?

**Say:** We needed transactions, constraints, joins and aggregation for the heatmap, and row-level security. PostgreSQL does all of that, and Supabase hosts it with auth, storage and a queue.

### C2. What is row-level security, and how do you use it?

**Say:** It's a database rule that filters rows per user. Students only ever get their own complaints, staff their department's, admins everything, even if the app code asked for more.
**Evidence:** pgTAP `001` and `002`.

### C3. Can a student make themselves an admin?

**Say:** No. Sign-up always creates a student, role data in sign-up is ignored, and users can only update their display name because of a column-level grant. Even admins can't change roles through the API.

### C4. Is the schema normalised?

**Say:** Yes for reference data: departments, rooms, equipment, routing. History tables deliberately snapshot the actor's role and assignment at that moment, because history should show what was true then.

### C5. How do you use transactions?

**Say:** Creating a ticket writes the complaint, its idempotency key, its first event and its case in one transaction. Linking a duplicate moves the report, merges the old case, supersedes other candidates and records events in one transaction.

### C6. What is idempotency and why does it matter?

**Say:** Submitting the same request twice should create one ticket. Each form has a key; the database stores it with a hash of the content. A double-click or a retry returns the same ticket; the same key with different content is refused.
**Evidence:** 10 simultaneous submissions with one key → 1 ticket ([p6-drills](../evidence/p6-drills.md)).

### C7. Which indexes matter?

**Say:** Composite indexes for each list (student's own, department queue, newest), partial unique indexes for "one active work order per case", "one pending proposal", "one active alert per rule".

### C8. How are duplicates stored without losing history?

**Say:** A report's link to its case moves; its old case becomes "merged" with a pointer to the new one; no event is deleted.

### C9. How is audit history protected?

**Say:** Event tables are append-only: a trigger rejects any update, even from the table owner. Config changes record before and after values.

### C10. How do you change the schema safely?

**Say:** Forward-only, additive migrations; tested locally and in CI; applied to the cloud after a dry run. We never drop tables as a rollback.

### C11. Do you use a vector index?

**Say:** We use pgvector to store and compare vectors, but no approximate index: we filter to a small set first (same building, last 30 days, open cases) and compute exact similarity. At a much larger scale we'd add an HNSW index.

---

## D. AI / ML

### D1. Which models do you use?

**Say:** Gemini 3.1 Flash-Lite for routing, photo analysis, the coordinator and repair checks; Gemini 3.5 Flash as a routing backup; and Gemini Embedding 2 at 768 dimensions for duplicate detection.

### D2. Did you train your own model?

**Say:** No. We use Gemini through its API. What we built is the system around it: prompts, schemas, tools, safety rules, database checks, the queue, and the datasets and scripts that measure it.
**Evidence:** [07, section 0](07-ai-ml-nlp-agentic-ai-concepts.md#0-the-honest-answer-first).

### D3. What is an embedding?

**Say:** A list of numbers representing meaning. Similar sentences give similar lists, so "sink pipe dripping" and "water under the washroom sink" end up close even with few shared words.

### D4. How is similarity calculated?

**Say:** Cosine similarity: the angle between two vectors. Then we combine it: 0.6 times similarity, plus 0.2 if same room, 0.1 if compatible category, 0.1 if same equipment. At 0.82 or above, an admin sees it as a candidate.

### D5. Why that formula and threshold?

**Say:** The weights come from our master plan; the threshold 0.82 was chosen on half of 60 labelled pairs and tested on the other half: precision 1.0, recall 0.8.
**Limit:** 60 synthetic pairs; real reports may need recalibration.

### D6. What does macro-F1 mean, and why use it?

**Say:** F1 balances precision and recall; macro means we average it over categories equally, so a rare category counts as much as a common one.

### D7. How good is the photo analysis?

**Say:** On 40 synthetic drawings, macro-F1 was 0.735, or 0.796 on clear ones. More importantly, every image that needed a person, blurry, dark, contradictory or unrelated, was sent to one: 14 out of 14.
**Limit:** Drawings, not photos; "other" category scored zero.

### D8. How do you handle hallucinations?

**Say:** The model can't write anything. It must answer in a fixed schema, department ids must come from the approved list, facts like department load come from the database, and every output is labelled a suggestion that a person can correct.

### D9. Why synthetic data?

**Say:** We had no consented real dataset, and real reports and photos contain personal data. Synthetic data let us label exactly and include hard cases on purpose. We're clear that it isn't real-world accuracy.

### D10. Is 40 images enough?

**Say:** Enough to test the pipeline and the review policy, not enough for a reliable accuracy estimate. One image moves a category's recall a lot.

### D11. How did you avoid overfitting the prompt to the test set?

**Say:** For routing we tuned only on 90 development reports and scored the 30 held-out ones just twice, for the first and final versions. For duplicates we chose the threshold on even pairs and reported odd pairs, and didn't re-weight after seeing the misses.

### D12. What happens with a real photo it has never seen?

**Say:** Gemini is a general vision model, so it will describe it, but we haven't measured accuracy on real campus photos. The design limits harm: unclear or risky results go to a person, and the analysis never changes routing or status.

### D13. Why not a simple keyword classifier?

**Say:** We have one, as a fallback. On our 120 reports it confidently routes about half and leaves the rest to people. The language model routes far more correctly, and the keyword rules catch outages.

### D14. Why embeddings instead of keyword matching for duplicates?

**Say:** Students describe the same problem with different words. Keywords miss "projector dead" vs "blue screen with a triangle"; embeddings capture meaning. And we add room and equipment because meaning alone can't tell two identical projectors apart.

### D15. How do you measure latency?

**Say:** Each evaluation records provider time per call. Routing p50 is about 1.1 seconds and p95 about 4.1 seconds with the final prompt; the first prompt's p95 was 16.8 seconds, which is why we redesigned it.

---

## E. Agentic AI

### E1. Why call it agentic AI?

**Say:** Because the model chooses actions in a loop: it decides which tool to call, our code runs it and returns the result, and it decides the next step until it proposes or asks for a human. That's different from one question and one answer. But it's deliberately bounded.

### E2. What tools does the routing agent have?

**Say:** Four: two read-only lookups, list departments and find a category's route, plus propose an assignment or request human review. None of them writes.

### E3. What tools does the coordinator have?

**Say:** Six: four reads, case context, equipment repair history, department load, and related cases, plus propose a work order or request admin review. Committing is a database function the model can't call.

### E4. How are tool calls authorised?

**Say:** The tool name must be on an allow-list, the arguments must pass a strict schema, and ids must be within the case being coordinated. Anything else is refused, counted, and explained to the model.

### E5. What can the agent decide automatically?

**Say:** A routine, single-report case with normal priority, no hazard, no repeat failure, a department under its load limit, and no reassignment can be committed automatically. Anything else waits for an administrator.

### E6. Who decides whether approval is needed: the AI?

**Say:** No. A fixed policy in code decides, using facts from the database: priority, safety words, repeat failures, department load, reassignment, category change, shared case.

### E7. How do you stop prompt injection?

**Say:** We contain it. Reports are sanitised and fenced as data; the prompt says to ignore instructions inside them; the model has no write tools; every proposal is checked by code and again in SQL. In our tests, injected instructions never changed an outcome.

### E8. What if the agent loops forever?

**Say:** It can't: routing has at most three exchanges and a 10-second deadline; the coordinator has at most four reads and six turns. If it doesn't decide, it goes to review.

### E9. What is stored about each agent run?

**Say:** Model, prompt version, outcome, failure code, duration, and a trace of tool names, ids, enum arguments and verdicts. Never the prompt or the report text, for privacy.

### E10. Why not a multi-agent system?

**Say:** The task is narrow and the facts are known. More agents would add cost, latency and unpredictability. A bounded agent with a fixed tool set is easier to test and to explain.

### E11. What if the coordinator's case changed while it was thinking?

**Say:** The job records the case version it was asked for. If the case changed, the run is recorded as superseded and nothing is applied.

### E12. Can the AI close a case?

**Say:** No. No AI component can close anything. Closing is done by the reporter or an administrator.

---

## F. Cloud computing

### F1. Where is it deployed?

**Say:** The web app on Vercel, serverless functions and CDN; the database, auth, storage, queue and worker on Supabase; AI from the Gemini API. All on free tiers.

### F2. What is serverless here?

**Say:** No server runs all the time. Vercel runs a function per request; Supabase runs the worker function when the scheduler calls it.

### F3. Why a queue?

**Say:** AI calls on photos can take seconds and can fail. The queue lets the user continue immediately, retries safely, and survives crashes. The job and its message are saved in the same transaction as the photo, so nothing is lost.

### F4. How does the worker get triggered?

**Say:** A cron job inside the database runs every minute; it only calls the worker if there's pending work, so idle minutes cost nothing.

### F5. What if the worker crashes mid-job?

**Say:** The job's message becomes visible again after a timeout, and the next run picks it up as attempt two. A late answer from the crashed run is refused. We tested this: the crashed job succeeded on attempt 2 with no duplicate.
**Evidence:** [a7-release](../evidence/a7-release.md).

### F6. How do you deploy?

**Say:** Push to GitHub; CI runs all tests; Vercel deploys a preview per branch and production from main. Database migrations and the worker are deployed by hand after review.

### F7. How do you roll back?

**Say:** Smallest step first: switch AI or a feature off; Vercel instant rollback for a bad build; a forward fix migration for schema problems.

### F8. What does it cost?

**Say:** Today, nothing: free tiers. For a full university we'd need paid Supabase and Vercel tiers and a paid Gemini quota. We haven't priced that; I'd estimate it from reports per day times model calls per report.
**Limit:** No cost study done. Don't quote a number.

### F9. How much would 10,000 students cost?

**Say:** I can't give a verified figure. The cost drivers are clear: one routing call per report, one per photo, one embedding per report, a few per coordinator run, plus database and hosting tiers. With real usage numbers we could estimate it accurately.

### F10. What are the free-tier risks?

**Say:** Gemini rate limits and 503 "high demand" errors, Supabase pausing after a week idle, limited auth emails. Each one has a fallback: reports still save and wait for a person.
**Evidence:** [free-tier quotas runbook](../runbooks/free-tier-quotas.md).

### F11. Why is production sharing a database with previews?

**Say:** The free plan allows two projects, and the second slot was in use. Only fictional data is stored, no automated test writes to it, and moving to a dedicated project is a configuration change.
**Limit:** A known limitation for real use.

---

## G. Cybersecurity

### G1. How do you authenticate users?

**Say:** Supabase Auth with email and password, HttpOnly cookies, and the session verified on the server for every page.

### G2. How is authorization enforced?

**Say:** Twice: the server checks the role for every page, and the database's row-level security and functions check again. The app can't bypass the database with a user's session.

### G3. Can a student see someone else's complaint?

**Say:** No. The database never returns it, and the API answers "not found", not "forbidden", so ids can't even be probed.

### G4. How are photos protected?

**Say:** A private bucket, uploads only into your own reserved slot, type and size limits, the real file signature and hash checked, no replacing, and viewing only through 5-minute signed links.

### G5. What stops someone uploading malware as an image?

**Say:** We check magic bytes, so a file must really be JPEG, PNG or WebP, plus a 2 MB limit. Images are only ever displayed, never executed.

### G6. Where are secrets kept?

**Say:** In Vercel's sensitive environment variables, Supabase function secrets and Vault, read only by one config module on the server. Nothing is committed to git.

### G7. Can students spam the system?

**Say:** There's a database limit of 20 reports per student per 10 minutes, and AI retries are limited. There's no CAPTCHA, and HTTP-level rate limiting isn't configured.

### G8. What about fake complaints?

**Say:** Every report is tied to a signed-in account, visible to admins, and recorded permanently. Staff can resolve with a note. We don't have abuse detection beyond that.

### G9. What if the AI is tricked into routing wrongly?

**Say:** It can only propose the approved department for a category, and high-priority or safety reports always go to a person. The worst case is a routine report going to the wrong department, which staff or an admin can reassign.

### G10. What personal data reaches Gemini?

**Say:** Only the report text and photos, with emails, phone numbers, ids and links replaced first. We use fictional data, and we warn that free-tier inputs may be used by the provider.

### G11. What security weaknesses remain?

**Say:** No nonce-based Content Security Policy yet, no external penetration test, and the shared preview/production database. Those would be fixed before real use.

---

## H. Testing

### H1. How did you test it?

**Say:** Five layers: 584 unit tests, 573 database tests with pgTAP, 151 integration tests against a local Supabase, 233 end-to-end browser tests on desktop and mobile with accessibility checks, and live AI evaluations on six datasets. CI runs all but the AI evaluations on every pull request.

### H2. What do database tests check?

**Say:** That every table has row-level security, that signed-in users can execute exactly 32 allowed functions, that AI write functions are service-role only, and that every rule and transition behaves.

### H3. How do you test AI without paying for calls?

**Say:** Unit tests inject fake responses into the real adapter; integration and E2E tests run against a local Gemini stub; only the evaluation scripts call the live model.

### H4. How do you know your tests catch real bugs?

**Say:** We broke things on purpose: removing a row lock made the concurrency test fail; ignoring the idempotency key made a test fail with four tickets; granting a forbidden function made the allow-list test fail.

### H5. What is a failure drill?

**Say:** A script that injects faults: AI on with no key, provider down, database write failing, ten simultaneous duplicate submits, two staff acting at once. 22 out of 22 checks passed: no report lost, no false success.

### H6. Did you test accessibility?

**Say:** Yes, axe-core runs inside the browser tests on both themes and on mobile, plus keyboard navigation tests.

### H7. Did you load test?

**Say:** Locally at 1, 5 and 20 concurrent students: zero errors, p95 under 230 ms for submissions. The photo queue handled 20 concurrent uploads, all analysed, with crash recovery. Live production was probed read-only up to 20 concurrent requests.
**Limit:** Not thousands of users.

### H8. What does CI do?

**Say:** On every pull request: lint, typecheck, formatting, unit tests, dependency audit, a local database, type drift check, database tests, integration tests, build, and browser tests on two devices. Nothing merges unless it's green.

### H9. What does your testing not prove?

**Say:** Real-world AI accuracy, behaviour with thousands of users, and security against attacks we didn't think of.

---

## I. Competition and originality

### I1. Why not use ServiceNow or Jira Service Management?

**Say:** For a university with budget and IT staff, a commercial tool may be the right answer: it has channels, notifications and support. Ours is focused on campus maintenance: shared cases with reporter confirmation, room-level heatmaps and cautious photo checks, and it was built to demonstrate cloud engineering.
**Evidence:** [10-existing-systems-comparison](10-existing-systems-comparison.md).

### I2. What is your original contribution?

**Say:** The safety architecture around AI, the report-versus-case model with linking, the durable queue with attempt tokens, the cautious photo policies, and the six labelled datasets with reproducible evaluations.

### I3. Isn't AI ticket classification already common?

**Say:** Yes. We don't claim it's new. What we show is how to make it safe: double-checked, auditable, with fallbacks, and measured.

### I4. Is there business value?

**Say:** Possibly for universities and colleges that can't afford enterprise tools. It would need notifications, single sign-on and real-data validation first.

### I5. What features do commercial tools have that you don't?

**Say:** Notifications and chat channels, knowledge bases, mobile apps, integrations, preventive maintenance scheduling, enterprise reporting and support.

### I6. How is your heatmap different from a dashboard chart?

**Say:** It's tied to rooms and equipment and counts distinct cases, so ten reports of one problem count once. Every number links back to the cases behind it.

### I7. Is your work feasible to adopt?

**Say:** Technically yes; operationally it needs a dedicated database, sign-on, notifications and someone to own it.

---

## J. Challenging or unexpected

### J1. Isn't this just a CRUD app connected to Gemini?

**Say:** The CRUD part is the easy part. The work is in what stops the AI from causing harm: four tools with no write access, a policy and a database re-check, fallbacks, a durable queue with retries and crash recovery, row-level security, idempotency, versioning, and evaluations. Remove the AI and the system still works; add a bad AI answer and nothing breaks.

### J2. Why should we consider this an AI project?

**Say:** AI does real work in six places: routing, photo understanding, semantic duplicate search, a tool-using coordinator, and photo comparison, all evaluated. And the engineering is about using AI responsibly, which is the hard part of applied AI today.

### J3. What happens if Gemini goes down?

**Say:** Reports are always saved first. Routing tries a backup model, then keyword rules, then waits for an administrator. Background jobs retry three times and then wait for an admin. Nothing is lost; things just take longer.

### J4. Why not use ChatGPT directly?

**Say:** ChatGPT is a chat product, not an API wired into a database with rules. We needed structured outputs, tool calling, images, embeddings and a free tier from one provider; Gemini gave us that. The model is replaceable: routing uses a provider-neutral interface.

### J5. What if your AI suggests the wrong department?

**Say:** It can only pick the approved department for a category, so the error would be the category. Staff can see it isn't theirs and an admin reassigns it in a click. High-priority and safety reports never get auto-routed.

### J6. What evidence shows your system improves complaint handling?

**Say:** Honestly, none from real use yet. We have evidence that it works correctly: tests, drills and evaluations. Measuring improvement needs a pilot with before-and-after numbers.

### J7. Can students manipulate the AI to get faster service?

**Say:** They can try writing "urgent, high priority". The model can't set high priority on its own: high priority always goes to a person. Injection attempts in our tests didn't change outcomes.

### J8. Can the system handle thousands of simultaneous complaints?

**Say:** The web tier is serverless and the AI work is queued, so it degrades gracefully. But we've only tested 20 concurrent users, and the free database tier would be the limit. I wouldn't claim thousands without a test on a paid tier.

### J9. Why didn't you train your own model?

**Say:** We had no real labelled data, training needs GPUs and time, and a foundation model already handles text and images. The right first step was to build a safe system and an evaluation method; with real data, fine-tuning or a smaller model could be compared.

### J10. What if duplicate detection wrongly matches two reports?

**Say:** It only suggests; an admin decides after seeing why it was suggested. If an admin links wrongly, each student still has their own report and confirmation. Unlinking isn't built yet; it would need a support fix.

### J11. Why should a university use this instead of ServiceNow?

**Say:** If they have the budget and staff for ServiceNow, they might not. Ours costs little, fits a student-first maintenance flow, and is explainable. It would be a good pilot or a fit for smaller institutions.

### J12. What would you improve with six more months?

**Say:** Real campus data and evaluation, Urdu support, notifications, university sign-on, a dedicated production database, embedding backfill for old reports, and unlinking duplicates.
**Evidence:** [12-future-improvements](12-future-improvements.md).

### J13. Why do some answers say "possible"? Isn't that weak?

**Say:** A photo can't prove a cause or that something works. Saying "possible" is correct. Our policy flags overconfident words like "definitely" for a person to check.

### J14. Your repair check accepted a partial repair. Isn't that dangerous?

**Say:** That's exactly why it can't close anything. In our evaluation it made two or three false acceptances out of about 25 answered pairs. The suggestion helps a person; the reporter still decides.

### J15. What if a staff member marks it resolved but it isn't?

**Say:** Staff can't close tickets. The student sees "Is it fixed?" and can reopen it with a reason. The insights page also flags cases reopened within a week of being resolved.

### J16. How do you know which projector it is?

**Say:** Equipment has codes like PRJ-ENG-204, tied to a room. Staff can set the equipment on a case. Free-text reports are matched to rooms when the text clearly matches; otherwise they stay "location unknown" rather than guessing.

### J17. What if the internet is down at the expo?

**Say:** We have recorded evidence: screenshots, evaluation reports, and a local copy that runs in Docker. The demo document has the fallback plan.

### J18. Did an AI write your code?

**Say:** Answer truthfully about your team's process. Then: every line is reviewed, tested in CI, documented in ADRs, and we can explain each decision, which is what this documentation is for.

### J19. Why does the student wait during submit?

**Say:** Routing runs inside the request with a 10-second limit, so most students see "assigned" immediately. Photos and other heavy work run in the background.

### J20. Why don't students choose the category themselves?

**Say:** Students often don't know which department handles what. Free text is easier for them; the AI and rules route it, and an admin can correct it.

### J21. Is the AI biased?

**Say:** It can reflect biases in its training and in our test data, which we wrote ourselves. Because routing decisions are limited to category and the safety cases always go to people, the impact is limited, but we'd study it on real data.

### J22. What happens to old reports when you turn on duplicate detection?

**Say:** Good question: right now, only reports made after the switch is on get embeddings, so older ones can't be matched. A backfill job is a planned fix.

### J23. How do you keep the demo data from looking real?

**Say:** All demo data is labelled synthetic and can be excluded with one filter on the heatmap, and the seed can reset it any time.

---

Total: 121 questions (A 10, B 12, C 11, D 15, E 12, F 11, G 11, H 9, I 7, J 23).
