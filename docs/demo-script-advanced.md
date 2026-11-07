# Demo script: advanced features in 6 minutes (plan v2 §17)

The add-on story on the live site, after (or instead of) the core demo in
[demo-script.md](demo-script.md). One seeded scenario runs through every feature: the ceiling
projector **PRJ-ENG-204** in Engineering **LAB-204**, which already has two closed repairs in the
demo history.

**Before starting** (the day before and one hour before):

1. Check that every `FEATURE_*` switch is on in Vercel and that production is on the expected commit
   (`pnpm smoke`).
2. Open the Supabase dashboard so the free project is awake, and check the worker:
   **Admin → AI jobs** has no stuck jobs, and an unauthenticated call to the worker URL answers 401.
3. Check the Gemini quota in Google AI Studio. If it is low, use the fallback at the end.
4. Re-apply the demo history (`supabase db query --linked -f supabase/seed.sql`); this resets the
   labelled demo cases only.
5. Copy the three drawn photos from [demo/photos](demo/photos) to the presenting machine.

Four browser windows, each signed in to one demo account:

| Window | Account                                  | Opens at              |
| ------ | ---------------------------------------- | --------------------- |
| 1      | `student.one@makeitright.test` (student) | `/student/complaints` |
| 2      | `student.two@makeitright.test` (student) | `/student/complaints` |
| 3      | `it.staff@makeitright.test` (IT staff)   | `/department`         |
| 4      | `admin@makeitright.test` (administrator) | `/admin`              |

All accounts, photos and reports are fictional drawings and text.

## The demo (6 minutes)

### 0:00–0:40 Report with a photo (F1)

- **Window 1:** report "Projector shows an error in LAB-204", building "Engineering Block", room
  "LAB-204". Attach `projector-lab204-before.png`.
- **Proof:** the report is saved at once ("We have your report"). The photo shows "Analysing…":
  its job is queued in the cloud, not in the request.

### 0:40–1:20 What the AI saw, and what it could not (F1)

- After the next worker run (within a minute), the photo card shows the observations, a possible
  issue, a suggested category, and "what the photo cannot show".
- Click "Not quite right" and correct it to show that the reporter has the last word.
- **Point out:** it never says "definitely"; uncertain photos go to a person.

### 1:20–2:00 The same problem, worded differently (F2)

- **Window 2:** "LAB 204 projector broken – blue screen with a triangle", same room, photo
  `projector-lab204-before-second-report.png`.
- **Window 4:** open the second report. "Possible duplicates" shows the first report's case, with
  similar wording, the same room and its score.
- Click **Same problem: link**. One shared case now holds both reports; each student keeps their
  own page.

### 2:00–3:00 The coordinator proposes, a person approves (F3)

- **Window 4**, same ticket, **Work order → Ask the coordinator**. After the worker run, open the
  run's trace: "Read the case… Checked a department's open work orders… Proposed a work order".
- It needs approval because the case is shared and the equipment repeats; the reasons are listed.
- Click **Approve work order**: one work order for IT Services, and both reports are now assigned.

### 3:00–3:55 Repair photo, AI comparison, human decision (F4)

- **Window 3** (IT staff), the ticket: **Repair verification → Add an after photo**
  (`projector-lab204-after.png`).
- After the worker run: before and after side by side, "AI suggestion: Looks improved", "no
  functional test".
- Mark the ticket resolved.
- **Window 1:** "Is it fixed?" shows the photos. Click **No, it is still a problem**: the case
  reopens with every photo kept. Then mention that "Yes, it is fixed" is the only way to close.

### 3:55–4:50 Where the problems are (F5, F6)

- **Window 4 → Campus heatmap:** Engineering floor 2. LAB-204 is the darkest room, and the
  number counts distinct cases (the two linked reports count once). Press Tab to a room and Enter
  to list its cases.
- **Insights:** "Repeat failures: PRJ-ENG-204 has 3 separate cases in 30 days". The evidence links
  go to the cases. **Acknowledge** it with a note.
- **Point out:** these are indicators from past cases with demo thresholds, not predictions.

### 4:50–6:00 The cloud and failure (A1, A7)

- **Window 4 → AI jobs:** the photo, embedding, duplicate, coordination and verification jobs,
  each with attempts and status.
- Show the Supabase dashboard: the `makeitright-ai-worker` Edge Function logs and the Cron job
  that calls it every minute.
- **Failure:** explain the evidence in [evidence/a7-release.md](evidence/a7-release.md). A worker
  that crashes mid-job has its job redelivered by the queue (attempt 2), with no duplicate
  result. A rate-limited Gemini call retries three times, then waits for a person. Reports are
  never lost.

## Fallback: Gemini quota exhausted or the provider down

The core app keeps working without AI (reports, routing by hand, work orders, heatmap, insights:
none of these need a model). The AI steps then show "waiting for a person", which is itself the
designed behaviour.

To show what the AI does, use the **precomputed, labelled** results from local runs. Say that
they are recorded results, not live:

| Feature               | Recorded example                                                                        |
| --------------------- | --------------------------------------------------------------------------------------- |
| F1 photo analysis     | [a2 screenshots](evidence/a2) and [visual eval](evidence/a2-visual-eval-visual-v1.md)   |
| F2 duplicates         | [a3 screenshots](evidence/a3) and [duplicate eval](evidence/a3-duplicate-eval.md)       |
| F3 coordinator trace  | [a4 screenshots](evidence/a4) and [25-scenario eval](evidence/a4-coordinator-eval.md)   |
| F4 before/after       | [a5 screenshots](evidence/a5) and [30-pair eval](evidence/a5-verification-eval-run1.md) |
| F5/F6 heatmap, alerts | live (no AI needed)                                                                     |

## Q&A: likely questions on the add-on

- **Can the AI close a case or change roles?** No. It only suggests. Closing needs the reporter
  or an administrator, and the coordinator has no tool that writes.
- **What if two reports are the same?** The system only suggests a link; an administrator
  decides, and each reporter keeps their page.
- **Is the heatmap real?** Every number is SQL over the cases, counted once per case. The demo
  history is labelled and can be excluded with one filter.
- **What does it cost?** Free tiers: Supabase Free, Vercel Hobby, Gemini free tier. Every AI step
  is queued and retried, so a quota limit delays work instead of losing it.
