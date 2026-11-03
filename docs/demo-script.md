# Demo script: 7-minute demo and 3-minute Q&A

For the PHEC Honhaar PINTEC Expo (15–16 November 2026, Lahore) and the supervisor review
(master plan P7.08). Live site: <https://makeitright-takeasy1.vercel.app>.

**Before starting:** follow the demo day checklist in
[runbooks/release.md](runbooks/release.md#demo-day-checklist-the-day-before-and-one-hour-before).
Use three browser windows (or profiles), each already signed in to one account:

| Window | Account                                     | Opens at              |
| ------ | ------------------------------------------- | --------------------- |
| 1      | `student.one@makeitright.test` (student)    | `/student/complaints` |
| 2      | `electrical.staff@makeitright.test` (staff) | `/department`         |
| 3      | `admin@makeitright.test` (administrator)    | `/admin`              |

All accounts and reports are fictional. Never type real names, phone numbers or student IDs.

## The demo (7 minutes)

### 0:00–0:45 The problem

> "On campus, broken lights, leaking pipes and dead projectors are reported on paper or by word
> of mouth. Nobody can see whether the right department got the report or whether anything
> happened. MakeItRight is a cloud web app: students report a problem in one minute, an AI agent
> sends routine reports straight to the right department, and every step is recorded."

Show the landing page on a phone-sized window too: the app is responsive.

### 0:45–2:00 A routine report, routed by AI (AI on)

Window 1, **Report an issue**:

- What is wrong?: `Projector shows no signal in Room 12`
- Describe the problem: `The projector turns on, but shows "No signal" with the HDMI cable from the teacher's desk. Tried two laptops.`
- Building: `Engineering Block`, Room (optional): `Room 12`

Submit. Point out:

- the ticket number (`MIR-…`) appears at once, because the report is **saved before the AI runs**;
- a few seconds later the status changes from **AI routing started** to **Assigned to IT
  Services**, with the category, priority and the AI's one-line reason in the timeline.

> "The model never writes to the database. It can only call three tools: look up the approved
> route for a category, propose a route, or ask for a human. The server checks every proposal
> against the routing rules, and the database checks it again."

### 2:00–3:00 Where the AI stops: a safety report (AI asks for a human)

Window 1, **Report an issue** again:

- What is wrong?: `Socket sparks and smells of burning`
- Describe the problem: `The wall socket beside the window sparks and smells of burning plastic when a charger is plugged in.`
- Building: `Hostel A`, Room (optional): `Room 210`

The ticket shows **Sent to an administrator** (status **Awaiting review**) instead of being
routed. In window 3 open **Review queue**:
the reason reads _"The report mentions a possible safety risk"_. Open the ticket and show the
**AI routing** section: the exact tool calls the model made and what the server decided. In
**Route this ticket**, choose Electrical Maintenance, category Electrical, priority High.

> "High-priority and safety reports always get a human decision. Automation is only for routine
> work."

### 3:00–4:15 The department does the work

Window 2 (electrical staff). The socket ticket is in the queue. Point out that this account sees
**only Electrical Maintenance tickets**, which the database enforces with row-level security.

**Acknowledge**, then **Start work**, then **Mark resolved** with this in _What was done?_:
`Replaced the damaged socket and checked the wiring.` Each step appears in the timeline with who
did it and when.

### 4:15–4:45 The student closes the loop

Window 1: the ticket shows **Resolved** with the staff note. Click **Yes, it is fixed**. (If it
were not fixed, **No, it is still a problem** sends it back with a reason, as demo ticket
MIR-1012 shows.)

### 4:45–5:45 The administrator's view

Window 3, **Overview** dashboard:

- open tickets, tickets awaiting routing, tickets by status, age of open tickets and new
  reports per day;
- the department workload table;
- **AI routing**: routed automatically vs. sent for review, with the review reasons.

Then **Departments**: switching a department off or changing a default route is recorded in the
**Recent configuration changes** list on that page. Do not save a change during the demo.

### 5:45–7:00 Cloud, reliability and the AI-off story

Use `docs/evidence/` (open in a tab beforehand):

- **Cloud architecture:** Next.js on Vercel serverless functions and CDN, Supabase PostgreSQL
  with Auth and row-level security, Gemini through a server-only adapter, GitHub Actions CI. All
  on free tiers.
- **Measured, not claimed** ([p6-resilience.md](evidence/p6-resilience.md)):
  - 20 simultaneous submissions with 0 errors;
  - duplicate submits never create a second ticket (20 out of 20 pairs);
  - live site p95 under 1 second from Pakistan.
- **AI off:** if Gemini is down, out of quota or switched off (`AI_ENABLED=false`), every report is
  still saved and lands in the review queue. Show the failure drill table: 22 out of 22 checks,
  and the screenshot of the error a student sees if the database itself fails (nothing typed is
  lost).
- **Quality:** each phase was merged only after its tests passed:
  - 382 unit tests;
  - 222 database security tests;
  - 80 API tests;
  - 151 browser tests, including accessibility checks on desktop and mobile.

> "So the AI makes the system faster, but the system never depends on it."

## If something goes wrong on stage

| Problem                          | Do this                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| The routine report is not routed | That is the AI-off path: show it in the review queue and assign it by hand. Same story.        |
| Venue Wi-Fi fails                | Switch to the phone hotspot. If that fails too, use the saved screenshots in `docs/evidence/`. |
| Sign-in fails                    | Use another window's account; the password is in the password manager.                         |
| The site is slow at first        | The free database was idle. Wait 10 seconds and reload, then continue.                         |

## Q&A (3 minutes): likely questions and short answers

**Why is this a cloud computing project?** It runs entirely on managed cloud services:
serverless functions and a CDN (Vercel), a managed PostgreSQL database with authentication
(Supabase), and a hosted AI model (Gemini). Nothing runs on a university server. It scales by
adding function instances, and it costs nothing on the free tiers.

**What if the AI makes a wrong decision?** It can only choose a department that the routing rules
already approve for the category, and the database re-checks that. High-priority, safety and
unclear reports always go to a person. The administrator can reassign any ticket, and every
decision is in the timeline.

**What happens without the AI?** Reports are still saved and wait in the admin review queue. We
tested this by removing the key and by making the provider unreachable: no report was lost.

**How do you stop students seeing each other's complaints?** Row-level security in PostgreSQL:
the database itself returns only your own tickets, or your department's. The web server cannot
bypass it, and 222 automated database tests check these rules.

**What stops someone submitting the same complaint twice?** Each submission carries a unique
key. Ten identical requests sent at the same moment produced exactly one ticket.

**Is student data sent to Google?** Only the complaint's title, description and location, never
names or emails. The demo uses fictional data only, as the free AI tier may use inputs to
improve the product.

**How does it perform?** Measured: 20 simultaneous submissions in about 0.2 seconds each on the
local build, and under 1 second (p95) to the live site from Pakistan, with no errors.

**What would you add next?** Photo evidence, email or WhatsApp notifications when a ticket
changes, Urdu language support, and a separate production database once we move off the free
tier.

**How long did it take, and who built it?** About one month, solo, following a phased plan where
each phase was tested and reviewed before the next began.

## Rehearsal log

| Date | Run | Time (min) | What went wrong | Fixed |
| ---- | --- | ---------- | --------------- | ----- |
|      | 1   |            |                 |       |
|      | 2   |            |                 |       |
|      | 3   |            |                 |       |
