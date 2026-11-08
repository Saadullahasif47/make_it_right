# 01. Project overview

## 1. What MakeItRight is

MakeItRight is a web application where university students report campus maintenance problems,
such as a broken light, a leaking tap or a dead projector, and follow them until they are fixed.

Three kinds of people use it:

- **Students** report problems and confirm when they are fixed.
- **Department staff** (Electrical, IT Services, Plumbing, Furniture, Sanitation, Facilities)
  see only their own department's work and move it forward.
- **Administrators** see everything, route what the system could not route, watch the AI, and
  look at campus-wide patterns.

AI helps at six points, and every one of them only **suggests**:

| Where                      | What the AI does                                                  | Who decides                                     |
| -------------------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| Routing (base system)      | Reads the report and proposes a category, department and priority | Code rules, then a person if unsure             |
| F1 Visual inspection       | Describes what a photo shows and what it cannot show              | The reporter or an admin                        |
| F2 Duplicate detection     | Finds earlier reports that may describe the same problem          | An administrator                                |
| F3 Coordination agent      | Reads a case through tools and proposes a work order              | A rule policy, then an admin for anything risky |
| F4 Repair verification     | Compares a before photo with an after photo                       | The reporter or an admin                        |
| F5/F6 Heatmap and insights | No AI: SQL counting and fixed rules                               | An administrator                                |

The full product name is **MakeItRight: AI Cloud-Based University Complaint System**. It runs on
Vercel (the web app) and Supabase (database, login, file storage, background worker), with
Google Gemini as the AI model.

Source: [README.md](../../README.md), [ADR 0005](../adr/0005-bounded-ai-triage.md),
[ADR 0008](../adr/0008-maintenance-foundation.md).

## 2. The problem it solves

A maintenance problem on campus has a simple life: someone notices it, the right people hear
about it, someone fixes it, and someone checks the fix. In practice each step can fail:

| Step                    | What goes wrong                                                                  |
| ----------------------- | -------------------------------------------------------------------------------- |
| Reporting               | Students do not know whom to tell, or assume someone else already did            |
| Reaching the right team | The report goes to a general office and waits to be forwarded                    |
| Duplicates              | Ten students report the same broken projector; staff see ten separate jobs       |
| Follow-up               | The student never hears back, so they cannot tell "in progress" from "forgotten" |
| Closing                 | Work is marked done without the person who reported it agreeing                  |
| Learning                | Nobody notices that the same projector failed three times this month             |

MakeItRight addresses each row: a one-minute report form, automatic routing to the right
department, duplicate suggestions, a visible timeline for every report, closing only by the
reporter (or an admin), and SQL-based alerts for repeat failures.

## 3. Why this matters in a university

- A university has many buildings, rooms and shared items (labs, projectors, washrooms), used by
  thousands of people who do not own them. Problems are seen by many and owned by few.
- Teaching depends on rooms working. A dead projector or a broken AC in a lab affects a whole
  class, not one person.
- Some problems are safety problems (sparking sockets, exposed wires, water near electrics).
  These must reach a person quickly and must not be handled by a guess.
- Administrators need evidence: which buildings generate the most work, which equipment keeps
  failing, which department is overloaded.

## 4. How complaints are usually handled without a system like this

This is a general description, not a survey of any particular university.

- **Verbal or paper:** tell a lab attendant, write in a register, or visit an office.
- **Messaging groups:** a photo in a class or department WhatsApp group.
- **Email or a generic form:** to an office address, forwarded by hand.
- **A general helpdesk ticketing tool:** usually set up for IT, not for buildings.

## 5. Weaknesses of those approaches

| Approach           | Weakness                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Paper or verbal    | No reference number, no status, no history, no numbers for planning                                                                |
| WhatsApp groups    | Messages scroll away; no owner; no status; photos mixed with chat; personal phone numbers exposed to everyone                      |
| Email or forms     | Someone must read and forward each one; duplicates are invisible; the sender rarely hears back                                     |
| Ordinary ticketing | Good at tracking, but usually not aware of rooms, equipment and repeat failures, and not designed so the reporter confirms the fix |

## 6. Why we chose this project

- It is a real, everyday problem that every student has seen.
- It needs every part of a cloud computing course: a hosted web app, a managed database with
  security rules, authentication, file storage, a queue, a background worker, scheduled jobs and
  an external AI service.
- It is a good place to use AI **carefully**: the AI can help with reading, routing and comparing,
  while a mistake has a clear human safety net.

## 7. Main objectives

1. A student can report a problem in about a minute and always see where it stands.
2. Routine reports reach the right department without an administrator.
3. Anything risky, unclear or safety-related goes to a person.
4. A report is never lost, even if the AI or the network fails.
5. Every change is recorded and cannot be silently edited.
6. Administrators can see where problems cluster and which equipment keeps failing.
7. Everything runs on free tiers and can be shown live.

## 8. Intended users

| User              | Account type | How they get an account                                     |
| ----------------- | ------------ | ----------------------------------------------------------- |
| Students          | `student`    | Sign up themselves; every sign-up is a student              |
| Maintenance staff | `department` | Created by script with a department (no in-app role editor) |
| Administrators    | `admin`      | Created by script                                           |

Source: [ADR 0002](../adr/0002-identity-access-and-environments.md),
[`scripts/seed-demo-accounts.mts`](../../scripts/seed-demo-accounts.mts).

## 9. Why it is useful to each group

**Students**

- One place to report, with a reference number like `MIR-1020`.
- A timeline showing who did what and when.
- They decide when their problem is fixed: "Yes, it is fixed" or "No, it is still a problem".

**Department staff**

- A queue with only their own department's work, oldest first, with "New" marked until
  acknowledged.
- Notes, start and resolve buttons, photos from the reporter, and (with F4) before/after photos.
- Protection against two people changing the same ticket at once.

**Administrators**

- A dashboard of open work, ageing, resolution time, department load and AI performance.
- A review queue for everything the AI did not route.
- Duplicate suggestions, coordinator proposals, a job monitor, a campus heatmap and recurrence
  alerts.

## 10. What makes it different from an ordinary complaint app

Plenty of ticketing tools exist (see [document 10](10-existing-systems-comparison.md)). What is
distinctive here is the combination and the safety design, not any single feature:

1. **Saved first, AI second.** The report is committed to the database before any AI runs. AI
   failure can only delay routing, never lose a report.
2. **AI suggests, rules and people decide.** Every AI output is validated, checked by
   deterministic code, and checked again inside the database.
3. **The database enforces access.** PostgreSQL row-level security decides who sees what; the web
   server cannot bypass it with a user's session.
4. **Reports and cases are separate.** Several students' reports can be linked to one
   maintenance case, while each student keeps their own report page and their own confirmation.
5. **Room- and equipment-aware.** Cases have locations and equipment codes, which feed the
   heatmap and the repeat-failure alerts.
6. **Measured, not claimed.** Each AI feature has an evaluation script and a written report with
   its limits.

## 11. Three ready-to-speak explanations

### 15-second elevator pitch

> "MakeItRight lets students report campus problems, like a broken projector, in a minute. AI
> routes routine reports to the right department, and anything risky goes to a person. Students
> follow every step and confirm the fix themselves, and admins see which rooms and equipment keep
> failing."

### One-minute explanation

> "Think about a projector that stops working in a lab. Today a student tells someone, maybe posts
> in a WhatsApp group, and never finds out what happened.
>
> In MakeItRight the student fills a short form and gets a reference number. The report is saved
> first. Then a Gemini model reads it and proposes a department, but our code checks that
> proposal against the approved routing rules, and anything high-priority or safety-related goes
> to an administrator instead.
>
> The IT staff see it in their queue, acknowledge it, start work and resolve it with a note. Only
> the student can confirm it is fixed, or reopen it.
>
> On top of that, the student can add a photo that the AI describes, duplicate reports are
> suggested for linking, and administrators get a heatmap and alerts like 'this projector has
> failed three times in thirty days'. It's all on Vercel and Supabase, with tests for every
> part."

### Three-minute detailed introduction

> "MakeItRight is a cloud-based complaint system for university maintenance. We built it because
> campus problems get reported in scattered ways: verbally, on paper, in WhatsApp groups. Nobody
> owns them, duplicates pile up, and students never hear back.
>
> There are three roles. Students report and follow their own problems. Department staff, for
> example IT Services or Plumbing, see only their department's queue. Administrators see
> everything.
>
> When a student submits, the report and its first history entry are written in one database
> transaction, with an idempotency key so a double-click can't create two tickets. Only after
> that does the AI run. The model is Gemini, and it has four declared tools. Two only look things
> up, one proposes a route, and one asks for a human. It cannot write anything. Our server checks
> its proposal: the department must be the approved one for that category, high priority always
> goes to a person, and a keyword safety screen catches things like sparks or flooding. Then the
> database checks the same rules again. If Gemini is down, we try a backup model, and then plain
> keyword rules, and if all of that fails the report simply waits for an administrator.
>
> Staff work the ticket through audited database functions. Every change bumps a version number,
> so if two people act at once one of them gets a clear 'this changed' message instead of
> silently overwriting. Every change adds an event to an append-only timeline.
>
> We then added six advanced features behind on/off switches. A student can attach a photo, and
> a background worker asks Gemini what is visible, what is not, and whether a person should look.
> New reports are turned into embeddings, which are number vectors of their meaning, and compared
> with recent cases in the same building to suggest duplicates for an admin to link. A
> coordination agent can read a case through six tools and propose a work order. A rule policy,
> not the model, decides whether that needs approval. Staff can upload a before and after photo
> and get a cautious comparison that always says no functional test was done. And administrators
> get a campus heatmap and recurrence alerts, which are pure SQL with no AI.
>
> We evaluated each AI part on synthetic data we built and labelled ourselves. For example, routing
> scored a macro-F1 of 0.981 on 30 held-out reports, and duplicate detection had a precision of 1.0
> and a recall of 0.8 on held-out pairs. We're careful to say these are synthetic results, not
> real-campus accuracy."

Every number in that pitch is checked in [document 8](08-datasets-and-evaluations.md).
