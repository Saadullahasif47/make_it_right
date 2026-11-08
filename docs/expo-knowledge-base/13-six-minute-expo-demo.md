# 13. Six-minute expo demo

This plan builds on [`docs/demo-script-advanced.md`](../demo-script-advanced.md) and adjusts it for
two facts learned during the cloud rehearsal on 2026-11-07/08:

1. **Background AI takes time.** The worker runs once a minute, so each photo analysis, duplicate
   check, coordinator run or repair comparison takes about 1–2 minutes. Four of them in a row
   cannot happen live inside six minutes. **Stage them before the demo** and say so honestly ("I
   submitted this one ten minutes ago").
2. **Duplicates only match reports made while the feature is on.** Both LAB-204 reports must be
   created after the switches are on.

Routing (the base AI) is synchronous: a new report is routed within seconds. That part is shown
**live**.

## 0. Where to run it

| Option                              | When                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| Production with the six switches on | Preferred. Turn them on for Production in Vercel, redeploy, run `pnpm smoke`         |
| The rehearsal preview               | `https://makeitright-git-main-takeasy1.vercel.app` (switches already on for Preview) |
| Local Docker copy                   | Only if the internet fails (see backups)                                             |

Accounts (fictional, from `scripts/seed-demo-accounts.mts`; rotate the password before the expo):

| Window | Account                        | Start page            |
| ------ | ------------------------------ | --------------------- |
| 1      | `student.one@makeitright.test` | `/student/complaints` |
| 2      | `student.two@makeitright.test` | `/student/complaints` |
| 3      | `it.staff@makeitright.test`    | `/department`         |
| 4      | `admin@makeitright.test`       | `/admin`              |

Use separate browser profiles so sessions don't mix. Photos: `docs/demo/photos/` (also in the expo
asset ZIP, folder `03-lab204-projector-demo`).

## 1. Staging, 30–60 minutes before

Do this in order and wait for each result.

1. **Window 1:** report "Projector shows an error in LAB-204", building `Engineering Block`, room
   `LAB-204`. Add `projector-lab204-before.png`. Wait for the AI observation (1–2 min).
2. **Window 2:** report "LAB 204 projector broken – blue screen with a triangle", same building and
   room. Add `projector-lab204-before-second-report.png`.
3. **Window 4:** open the second report. Wait for **Possible duplicates** (about a minute after
   submitting; refresh). **Do not link yet** if you want to link live; otherwise link now.
4. **Window 4:** (optional) in **Room and equipment**, set equipment `PRJ-ENG-204` so the
   coordinator also sees the repeat-failure history.
5. **Window 4:** after linking, **Work order → Ask the coordinator**. Wait 1–2 minutes. Expect
   **Proposal waiting for your approval** with "shared case" (and "repeat failure" if equipment is
   set). **Do not approve yet.**
6. **Window 3:** on the ticket, **Start work**, then **Repair verification → Add a before photo**
   (`projector-lab204-before.png`) and **Add an after photo** (`projector-lab204-after.png`). Wait
   for the comparison. **Do not resolve yet** if you want to resolve live.
7. **Window 4:** **Insights → Refresh now**.
8. Leave each window on the page you'll show first.

## 2. The six minutes

| Time      | Window | Do                                                                                                                                                                                             | Expect                                                                                                       | Say                                                                                                                              |
| --------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:45 | —      | Landing page                                                                                                                                                                                   | —                                                                                                            | The problem and the 15-second pitch ([document 1](01-project-overview.md#15-second-elevator-pitch))                              |
| 0:45–1:30 | 1      | **Report an issue**: "Chair leg snapped in CR-101", building `Science Block`, room `CR-101`, a short description. Submit                                                                       | Within seconds: report page, `MIR-…`, then "Assigned to Furniture and Fixtures" in history by "AI assistant" | "Saved first, then the AI proposes a route; our rules and the database check it."                                                |
| 1:30–2:30 | 1, 4   | Open the staged LAB-204 report: the **AI observation**. Then window 4: the second report's **Possible duplicates**, "Why it was suggested", **Same problem: link** (or show it already linked) | Observation card with Visible / Not visible; candidate with score; one shared case                           | "The AI says what it sees and what a photo can't show. Duplicates are found by meaning plus room, and only an admin links them." |
| 2:30–3:30 | 4, 3   | **Work order**: the pending proposal, **Why a person must approve it**, open **Tool calls**, **Approve work order**. Then window 3: the department queue                                       | Approved; IT Services has the work order; both reports assigned                                              | "The coordinator used read-only tools; a rule policy, not the model, decided this needs approval."                               |
| 3:30–4:30 | 3, 1   | Window 3: **Repair verification** with before/after and "Photo comparison only: no functional test was done"; **Mark resolved** with a note. Window 1: **Is it fixed?** → **Yes, it is fixed** | Ticket closed; review confirmed                                                                              | "AI never closes anything. The student decides."                                                                                 |
| 4:30–5:30 | 4      | **Campus heatmap** → Engineering, floor 2; Tab to LAB-204, Enter. **Insights**: the repeat-failure alert with its evidence cases; **Acknowledge** with a note                                  | Darker LAB-204; alert lists cases                                                                            | "Pure SQL, counted per distinct case, every number traceable. Indicators, not predictions."                                      |
| 5:30–6:00 | —      | —                                                                                                                                                                                              | —                                                                                                            | Close: what's distinctive and the honest limits (below)                                                                          |

## 3. If something goes wrong

| Problem                                   | Do this                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| New report stays "needs review" (AI busy) | Say "this is the designed fallback: saved and waiting for a person". Route it from window 4 with **Route this ticket**                     |
| Photo still "Analysing…" after 2 min      | Show the staged report instead. Check **AI jobs** (window 4) for its state                                                                 |
| No duplicate candidate                    | Check both reports were made after the switch was on, and in the same building. Show the [a3 evaluation](../evidence/a3-duplicate-eval.md) |
| No approval button                        | The case was low risk, so the policy committed it automatically. Explain that this is correct; show the run's tool calls                   |
| Session expired                           | Sign in again from `/login` (have the password ready offline)                                                                              |
| Gemini quota exhausted                    | Use staged results and the evaluation reports; core flows (submit, route by hand, work, close, heatmap, insights) need no AI               |
| Supabase paused or down                   | Resume it in the dashboard (takes minutes); meanwhile use screenshots from the expo ZIP                                                    |
| No internet                               | Run the local copy (`pnpm db:start`, `pnpm build`, `pnpm start`), or present the screenshots and evidence reports                          |

## 4. Scripts

### Six-minute presentation script

> **(0:00)** "Hi, we're presenting MakeItRight. When a projector or a tap breaks on campus, students
> usually tell someone or post in a group, and never find out what happened. MakeItRight gives
> every problem an owner, a status and a history, and uses AI carefully to speed it up."
>
> **(0:45)** "I'm a student. I report a broken chair: what, where, a short description. Submit.
> The report is saved first, with a reference number. Then a Gemini model reads it and proposes a
> department. Our code checks that against the approved routing rules, and the database checks it
> again. Here it is: assigned to Furniture, by the AI assistant, in a few seconds. If it had said
> 'sparks' or 'injury', it would go to a person instead."
>
> **(1:30)** "Earlier, two students reported the LAB-204 projector. The first added a photo. The AI
> lists what it can see, a blue screen with a warning triangle, and what it can't, like the cause.
> It's labelled as a suggestion. The second student used different words, but the system found the
> match using embeddings, which are numbers representing meaning, plus the same room. Only an
> admin can link them. Now it's one case with two reports, and each student keeps their own page."
>
> **(2:30)** "The admin asked the coordination agent to look at it. It's a bounded agent: it can
> only call read tools: case details, the projector's history, the department's load. It proposed
> IT Services. Because it's a shared case, a fixed rule says a person must approve, not the AI.
> Here are its tool calls. I approve."
>
> **(3:30)** "IT staff uploaded before and after photos. The AI compares them and says 'looks
> improved', and it always says no functional test was done. It can never close a case. Staff mark
> it resolved; the student confirms: yes, it's fixed."
>
> **(4:30)** "Administrators see a campus heatmap. Each room's colour is the number of distinct
> cases, so duplicates don't inflate it. LAB-204 stands out. Insights flags that this projector had
> three cases in thirty days. These are SQL rules, not predictions, and every alert links to its
> evidence."
>
> **(5:30)** "So: reports are never lost, AI only suggests, rules and people decide, and everything
> is recorded. We measured each AI part on our own labelled synthetic datasets, for example
> routing at 0.98 macro-F1 on held-out reports, and we're clear that real-campus testing is the next
> step. Thank you."

### Two-minute version

> "MakeItRight is a campus maintenance reporting system. A student reports a problem in a minute and
> gets a reference number. The report is saved first; then a Gemini model proposes a department,
> and our rules and the database double-check it. Safety-related or unclear reports go to an
> administrator. Staff see only their department's queue, and only the student can confirm a fix.
>
> On top of that: a student can add a photo that the AI describes cautiously; similar reports are
> found by meaning and room and linked by an admin into one case; a bounded coordination agent
> proposes work orders, with risky ones needing approval; before-and-after repair photos get a
> comparison that can never close a case; and admins see a heatmap and recurrence alerts computed
> in SQL.
>
> It runs on Vercel and Supabase with a queue and a background worker, over 1,500 automated tests,
> and six evaluation datasets. The data is synthetic, so real-campus testing is our next step."

### 30-second pitch

> "MakeItRight lets students report campus problems in a minute and track them until they confirm
> the fix. AI routes routine reports, describes photos, finds duplicates and compares repair
> photos, but it only suggests: rules, the database and people decide. Nothing is lost if the AI
> fails."

## 5. Five strongest technical selling points

1. **Saved-first, double-checked AI:** report committed before AI; model proposals checked by code
   and again in SQL; the model has no write access.
2. **Database-enforced security:** RLS on all 27 tables; exactly 32 callable functions, tested.
3. **Reliable background processing:** transactional queue, retries with backoff, attempt tokens,
   crash recovery proven by a drill.
4. **Reports vs shared cases:** duplicates linked without losing anyone's report or confirmation.
5. **Evidence:** six labelled datasets and scripts that run the production code path; ~1,500
   automated tests in CI.

## 6. Five honest limitations

1. All AI results are on **synthetic** data; real-world accuracy is unknown.
2. **No notifications**; students check the site.
3. **One database** shared by preview and production on free tiers.
4. Duplicate detection does not cover reports made before it was switched on; no unlinking.
5. English only; tested at 20 concurrent users, not thousands.

## 7. The most impressive workflow

The LAB-204 story: two differently worded reports → one shared case → coordinator proposal that a
rule (not the AI) sends for approval → approve → before/after check that says "no functional
test" → each student confirms → heatmap and repeat-failure alert. It shows every AI feature and
every safety boundary in one thread.

## 8. Checklists

### The evening before

- [ ] Production on the expected commit: `pnpm smoke` passes.
- [ ] Decide production vs preview; if production, the six `FEATURE_*` switches are on for
      Production and redeployed.
- [ ] Supabase project active (not paused); **AI jobs** page has no stuck jobs.
- [ ] Gemini quota checked in Google AI Studio.
- [ ] Demo password rotated (`pnpm seed:demo` with a new `DEMO_ACCOUNT_PASSWORD`) and written down
      offline.
- [ ] Demo history reset if needed: `pnpm exec supabase db query --linked -f supabase/seed.sql`.
- [ ] Full rehearsal once, timed.
- [ ] Laptop: four browser profiles signed in; photos on the desktop; expo ZIP screenshots ready.
- [ ] Local fallback works: Docker, `pnpm db:start`, `pnpm build`, `pnpm start`.

### The morning of the expo

- [ ] Open the Supabase dashboard (wakes the project); check the worker answers 401 to an
      unauthenticated call.
- [ ] `pnpm smoke`.
- [ ] Sign in to all four windows; check sessions.
- [ ] Do the staging steps (section 1) 30–60 minutes before the first visitors.
- [ ] Phone hotspot ready as a backup connection.
- [ ] Re-read [document 15](15-quick-revision-cheatsheet.md).
