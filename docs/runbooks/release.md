# Runbook: release, demo day and rollback

Production: <https://makeitright-takeasy1.vercel.app>. It uses the Supabase project
`makeitright-staging` (ref `ijmikxhkyrensmsnmvmb`), the only cloud database (ADR 0002, ADR 0007).
Variables and auth settings are in [cloud-environments.md](cloud-environments.md).

## Releasing a change

1. Open a PR from a `phase/…` or `fix/…` branch. CI must be green: lint, typecheck, unit, pgTAP,
   integration, E2E with axe, and production build.
2. If the PR adds a migration, apply it to the cloud project **before** merging (migrations are
   additive, so the running version keeps working):

   ```bash
   pnpm exec supabase db push --dry-run
   pnpm exec supabase db push
   pnpm exec supabase migration list --linked     # local and remote columns must match
   ```

3. Merge the PR. Vercel deploys `main` to production in about a minute.
4. Check that the deployed commit is the merged one, and run the read-only smoke test:

   ```bash
   git checkout main && git pull
   pnpm smoke                                    # 27 checks; fails if the deployed SHA differs
   ```

5. Sign in as each demo role once and look at the dashboard (see the demo checklist below).

## Demo day checklist (the day before, and one hour before)

- [ ] Open the Supabase dashboard so the free project is not paused (it pauses after about a
      week without activity), then load the production URL.
- [ ] Once, before the expo: rotate the demo password (it was shared in a chat during
      development) with `scripts/seed-demo-accounts.mts` from the owner's machine, as in
      [cloud-environments.md](cloud-environments.md#demo-accounts-on-the-cloud-project).
- [ ] `pnpm smoke` passes.
- [ ] Sign in as `student.one`, `electrical.staff` and `admin` (all `@makeitright.test`). The
      password is in the owner's password manager and never in this repository.
- [ ] The admin dashboard shows the demo tickets (MIR-1005 to MIR-1016).
- [ ] Submit one test report as `student.one` and watch it get routed (AI on). If Gemini is slow or
      out of quota, the ticket waits in **Needs review**, which is the AI-off story in the demo.
- [ ] Phone charged, laptop on mains power, a mobile hotspot ready in case the venue Wi-Fi fails.
- [ ] Screenshots of every demo step saved offline (`docs/evidence/`) as a fallback.

Visitors should use the demo accounts, not sign up. The free email sender allows only a few
emails per hour, so confirmation emails for new sign-ups may be delayed.

## Demo data

`supabase/demo/demo-tickets.sql` adds 12 fictional tickets in every workflow state. It calls the
application's own audited functions, so each ticket has a genuine timeline. It is safe to re-run:
existing tickets are detected by their fixed idempotency keys and skipped.

```bash
# local stack
docker exec -i supabase_db_makeitright psql -U postgres -d postgres < supabase/demo/demo-tickets.sql
# cloud project (writes to production; fictional data only)
pnpm exec supabase db query --linked -f supabase/demo/demo-tickets.sql
```

The demo accounts must exist first (`pnpm seed:demo` locally; for the cloud see
[cloud-environments.md](cloud-environments.md#demo-accounts-on-the-cloud-project)).

## Rollback

Pick the smallest step that stops the problem.

| Problem                                      | Action                                                                                                                                                     | Time       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| AI routes badly, is slow, or Gemini is down  | Vercel → Settings → Environment Variables: `AI_ENABLED=false`, then redeploy. Tickets are still accepted and wait in the admin review queue.               | 2 minutes  |
| A bad deployment (errors, broken page)       | Vercel → Deployments → the previous production deployment → **Instant Rollback**. No rebuild; the old build serves at once. Then revert the PR on GitHub.  | 1 minute   |
| A department or routing rule set wrongly     | `/admin/departments`: switch it back. Every change is in the change log on that page.                                                                      | 1 minute   |
| A bad migration                              | Never edit or delete an applied migration. Write a new migration that undoes the change, test it locally (`pnpm db:reset`, `pnpm db:test`), then push it.  | 30 minutes |
| A secret is exposed (Supabase or Gemini key) | Rotate it in the provider's dashboard, update the Sensitive Vercel variable, redeploy. Check `git log -p` that it was never committed.                     | 10 minutes |
| The cloud database is lost or corrupted      | Free projects have no point-in-time restore. Rebuild: `supabase db push --include-seed`, apply `supabase/seed.sql`, re-create demo accounts and demo data. | 20 minutes |

After any rollback, `pnpm smoke` must pass again. Note the cause in the PR or issue that fixes
it.

## Code freeze

The submitted version is tagged. Only fixes for defects found in rehearsal go in after the tag,
each through a PR with green CI, and the tag moves only with the owner's agreement.

```bash
git tag -a v1.0.0 -m "MakeItRight 1.0: PINTEC 2026 submission" && git push origin v1.0.0
```
