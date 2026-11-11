# 14. Critical project review

Written as an independent reviewer would, from the repository and the cloud checks of
2026-11-07/08. Severity: **Critical** (would block real use or mislead judges), **High**,
**Medium**, **Low**.

## 1. Weaknesses, ranked

| #   | Weakness                                                                                                       | Severity              | How to talk about it                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **No real-world validation.** Every AI number comes from synthetic data written or drawn by the team           | Critical (for claims) | "Our numbers show the design works on labelled synthetic data. Real-campus accuracy is unknown, and a pilot is our next step." Never present them as real accuracy |
| 2   | **Add-on features are switched off on production** (on for preview only, as of 2026-11-08)                     | High                  | Turn them on for production before the expo, or say "these run on our staging preview"                                                                             |
| 3   | **Shared database for preview and production**, free tier, no backups plan beyond the provider's defaults      | High                  | "A free-plan constraint, documented; moving to a dedicated project is a configuration change"                                                                      |
| 4   | **No notifications**                                                                                           | High                  | "Students see status on the site; notifications are first on our list"                                                                                             |
| 5   | **Duplicate detection misses reports made before it was switched on** (no embedding backfill); no unlinking    | Medium                | "Found in rehearsal; a small backfill job fixes it"                                                                                                                |
| 6   | **Visual evaluation is weak on "other"** (0/3) and uses simple drawings                                        | Medium                | "The policy still sends unclear photos to a person; that's why it's a suggestion"                                                                                  |
| 7   | **Repair check false acceptances** (2–3 of ~21–25 answered pairs)                                              | Medium                | "Exactly why the AI cannot close anything"                                                                                                                         |
| 8   | **Free-tier fragility**: Gemini 503 streaks and rate limits; project pause after idle                          | Medium                | "Designed to degrade: reports save and wait; jobs retry"                                                                                                           |
| 9   | **Load tested only to 20 concurrent users**                                                                    | Medium                | "Serverless web tier and a queue for AI; database tier is the limit; not tested at scale"                                                                          |
| 10  | **Synchronous routing in the submit request** (up to 10 s wait)                                                | Low                   | "A deliberate trade-off so most reports are routed instantly; bounded by a deadline"                                                                               |
| 11  | **No nonce CSP, no penetration test, no CAPTCHA, no HTTP-level rate limit**                                    | Medium                | "Defence in depth is mostly in the database; these are pre-production items"                                                                                       |
| 12  | **Roles set by script**; no university sign-on                                                                 | Medium                | "Fine for a prototype; required for adoption"                                                                                                                      |
| 13  | **Heatmap depends on location matching**; free-text rooms often stay "unknown"                                 | Low                   | "We prefer unknown over wrong; staff can place cases"                                                                                                              |
| 14  | **Insights thresholds are demo values**, not calibrated                                                        | Low                   | "Indicators with documented thresholds; calibration needs real history"                                                                                            |
| 15  | **English only**                                                                                               | Medium                | "Urdu and Roman Urdu are planned; Gemini can read them, but rules and evaluation need work"                                                                        |
| 16  | **Documentation drift**: the repository README predates the add-on; "three tools" vs four                      | Low                   | Fixed or noted in this knowledge base                                                                                                                              |
| 17  | **Coordinator runs only on request**, not automatically                                                        | Low                   | "A cost and safety choice; automatic runs are a later decision"                                                                                                    |
| 18  | **The refusal path for unauthorised agent calls is proven only by stub tests**; the live model never tried one | Low                   | "Good for the model, but we tested the refusal code directly"                                                                                                      |

## 2. Features that sound bigger than they are

| Sounds like                       | Actually is                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| "AI agent"                        | A bounded tool-calling loop with 4–6 fixed tools, no write access, and a small budget |
| "Predictive maintenance insights" | Four SQL rules with fixed thresholds. **Not predictive and not machine learning**     |
| "AI repair verification"          | A cautious visual comparison suggestion; it cannot verify that anything works         |
| "Computer vision"                 | Calls to Gemini's general vision model; no custom vision model                        |
| "Vector database"                 | pgvector inside PostgreSQL with exact search on a small filtered set                  |
| "Heatmap"                         | Schematic SVG floor plans with a severity-weighted count, not a geographic map        |

Saying these plainly earns more trust than the bigger words.

## 3. Areas judges are likely to challenge

1. "Isn't this just CRUD plus Gemini?" → the safety architecture ([document 11, J1](11-expo-judges-100-questions.md#j1-isnt-this-just-a-crud-app-connected-to-gemini)).
2. "Did you train a model?" → no, and why ([document 7](07-ai-ml-nlp-agentic-ai-concepts.md#0-the-honest-answer-first)).
3. "Synthetic data?" → why, and what it does not prove ([document 8](08-datasets-and-evaluations.md#hard-questions-about-the-data)).
4. "Cost at scale?" → drivers, no invented numbers.
5. "Why not ServiceNow?" → fair comparison ([document 10](10-existing-systems-comparison.md)).

## 4. Strengths an independent reviewer would note

- Clear separation of AI suggestion from decision, enforced in three layers (prompt/tools, code
  policy, SQL).
- Security in the database: RLS everywhere, explicit grants, a tested function allow-list.
- Correctness under concurrency: idempotency, versions, row locks, attempt tokens, all tested with
  deliberate mutations.
- Unusually complete engineering records: 14 ADRs, evidence per phase, runbooks.
- Honest evaluation write-ups that state their limits.

## 5. Overall judgement

| Level                                 | Verdict                       | Why                                                                                                               |
| ------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| A basic academic project              | Exceeds                       | Far beyond CRUD: queue, worker, RLS, agents, evaluations, CI                                                      |
| A strong undergraduate project        | **Yes**                       | Depth of engineering, testing and documentation                                                                   |
| An impressive university expo project | **Yes**, if demonstrated well | A live, deployed system with visible AI and visible safety; needs the switches on and a rehearsed demo            |
| A research-ready system               | Partly                        | The platform and evaluation scripts are ready; the data is not. Needs a real, consented dataset and a pilot study |
| A production-ready commercial product | **No**                        | Shared free-tier database, no notifications, no SSO, no real-data validation, no security audit, no support model |

**In one sentence:** a strong, well-engineered and well-documented undergraduate system that is
honest about its AI, ready to be demonstrated, and a solid base for a real-data pilot, but not a
production product.
