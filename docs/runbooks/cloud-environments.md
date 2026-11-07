# Runbook: cloud environments (Supabase + Vercel)

| Item             | Value                                                                   |
| ---------------- | ----------------------------------------------------------------------- |
| Supabase project | `makeitright-staging`, ref `ijmikxhkyrensmsnmvmb`, Free plan            |
| Supabase URL     | `https://ijmikxhkyrensmsnmvmb.supabase.co`                              |
| Used by          | Vercel previews **and** production (ADR 0002)                           |
| Vercel project   | `takeasy1/make_it_right`, Hobby plan, framework pinned in `vercel.json` |
| Production URL   | <https://makeitright-takeasy1.vercel.app>                               |
| Preview URLs     | `https://makeitright-git-<branch>-takeasy1.vercel.app`                  |

Free-plan reminders: projects pause after about a week of inactivity, so open the dashboard the
day before a demo. The built-in email sender allows only a few emails per hour.

## Applying migrations to the cloud project

Do this before merging a PR whose migrations the preview needs. Migrations must be additive.

```bash
pnpm exec supabase login                                  # opens the browser once
pnpm exec supabase link --project-ref ijmikxhkyrensmsnmvmb # asks for the database password
pnpm exec supabase db push --dry-run                       # review what will run
pnpm exec supabase db push --include-seed                  # migrations + reference departments
```

The owner types the database password; it is never stored in the repository.

**A changed seed is not re-run.** `--include-seed` executes `supabase/seed.sql` only the first
time. After that, if the file changes, the CLI just records the new hash ("Updating seed hash")
and skips the inserts. The seed is idempotent, so apply a changed seed explicitly and check it:

```bash
pnpm exec supabase db query --linked -f supabase/seed.sql
pnpm exec supabase db query --linked "select count(*) from public.routing_rules"   # expect 6
```

## Auth settings (dashboard → Authentication)

- **URL Configuration**
  - Site URL: `https://makeitright-takeasy1.vercel.app`
  - Redirect URLs: `https://makeitright-takeasy1.vercel.app/**`,
    `https://*-takeasy1.vercel.app/**`, `http://localhost:3000/**`
- **Sign In / Providers → Email**: confirm email ON; minimum password length 10; password
  requirements "letters and digits" (mirrors `supabase/config.toml`).
- **Email Templates**: for links that work on any device, change the link in the "Confirm
  signup" template to `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email` and in "Reset
  password" to `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`. The default
  templates also work, but only in the same browser.

## Vercel environment variables (Settings → Environment Variables)

| Name                                   | Environments        | Value                                      |
| -------------------------------------- | ------------------- | ------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | Production, Preview | `https://ijmikxhkyrensmsnmvmb.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production, Preview | the project's `sb_publishable_…` key       |
| `APP_BASE_URL`                         | Production only     | `https://makeitright-takeasy1.vercel.app`  |
| `AI_ENABLED`                           | Production, Preview | `true` to turn on AI triage (Phase 4)      |
| `GEMINI_MODEL`                         | Production, Preview | `gemini-3.1-flash-lite`                    |
| `GEMINI_API_KEY`                       | Production, Preview | Google AI Studio key, **Sensitive**        |
| `SUPABASE_SECRET_KEY`                  | Production, Preview | the `sb_secret_…` key, **Sensitive**       |
| `FEATURE_*` (six add-on switches)      | Preview first       | unset (OFF) until a phase is verified      |
| `GEMINI_EMBEDDING_MODEL`               | Production, Preview | `gemini-embedding-2` (default)             |

`SUPABASE_SECRET_KEY` is read only by the agent's privileged routing adapter (ADR 0005). Mark it
Sensitive, never prefix it with `NEXT_PUBLIC_`, and rotate it in the Supabase dashboard if it is
ever exposed. Never set `GEMINI_BASE_URL` on Vercel: the app refuses to start with it.

To switch AI off quickly, set `AI_ENABLED=false` and redeploy. Tickets are still accepted and
wait in the admin review queue.

The add-on features (plan v2, ADR 0008) each have their own switch: `FEATURE_VISUAL_INSPECTION`,
`FEATURE_DUPLICATE_DETECTION`, `FEATURE_MAINTENANCE_COORDINATOR`, `FEATURE_REPAIR_VERIFICATION`,
`FEATURE_CAMPUS_HEATMAP` and `FEATURE_MAINTENANCE_INSIGHTS`. They are OFF unless set to `true`.
Turn them on in Preview first, one at a time, and only after the phase's gate is verified.
Switching one off and redeploying is the first rollback step.

After the add-on A0 migration is pushed, apply the changed seed (campus rooms, assets and the 60
synthetic cases) with `supabase db query --linked -f supabase/seed.sql`. It is safe to re-run:
it only replaces the synthetic cases.

## Demo accounts on the cloud project

Run from the owner's machine with the secret key in the shell only (not in a file):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://ijmikxhkyrensmsnmvmb.supabase.co \
SUPABASE_SECRET_KEY='sb_secret_…' DEMO_ACCOUNT_PASSWORD='…' \
node scripts/seed-demo-accounts.mts
```

## AI job worker (add-on A1, ADR 0009)

The queue consumer is the `makeitright-ai-worker` Edge Function. Supabase Cron calls it every
minute while jobs are pending, but only once both Vault secrets below exist. Deploy it with the
owner, as part of plan A7.03:

1. `pnpm exec supabase functions deploy makeitright-ai-worker` (it uses `verify_jwt = false` from
   `supabase/config.toml`; the shared secret is the authentication).
2. Generate a random secret of at least 32 characters, never typed on a command line. Set it
   both as the function secret `AI_WORKER_SECRET` (`supabase secrets set --env-file <tmp file>`)
   and as the Vault secret `makeitright_ai_worker_secret`.
3. Store the function URL `https://<project-ref>.supabase.co/functions/v1/makeitright-ai-worker`
   as the Vault secret `makeitright_ai_worker_url`.
4. Check the result in **Admin → AI jobs** (shown when a queue feature flag is on), or in
   `public.ai_jobs`.

The worker's own secrets for AI work (set with `supabase secrets set --env-file`, never typed on
a command line): `AI_ENABLED=true`, `GEMINI_API_KEY`, and optionally `GEMINI_VISION_MODEL` and
`GEMINI_EMBEDDING_MODEL` (default `gemini-embedding-2`). Without `AI_ENABLED=true` every AI job
goes to review as `AI_DISABLED`; the stored photos and reports are unaffected.

**Trap: `supabase secrets set` also uploads `[edge_runtime.secrets]` from `supabase/config.toml`.**
Those are the local stack's values (the stub's `GEMINI_BASE_URL`, `AI_WORKER_FAULTS`, a stub key
and the well-known local worker secret). Values in your `--env-file` win, but anything only in
`config.toml` is added to the cloud. Always check afterwards and remove the local-only ones:

```bash
pnpm exec supabase secrets list            # names only matter; values are shown as hashes
pnpm exec supabase secrets unset GEMINI_BASE_URL AI_WORKER_FAULTS
```

The worker protects itself: on a hosted project it refuses to start (503
`WORKER_NOT_CONFIGURED`) while `GEMINI_BASE_URL` is set or the secret is the local value, and it
ignores `AI_WORKER_FAULTS`. An unauthenticated call to a healthy worker answers 401.

To pause the worker, delete the two Vault secrets; Cron then sends nothing. Never set
`AI_WORKER_FAULTS` on a hosted project: the worker ignores it there anyway, but it exists for
local drills only.
