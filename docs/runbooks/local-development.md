# Runbook: local development

## One-time setup

1. Install Node.js 24 LTS and Docker Desktop, then run `corepack enable` so pnpm 11.5.1 (pinned
   in `package.json`) is used.
2. Clone, then run `pnpm install`.
3. Run `pnpm exec playwright install chromium` (needed for E2E tests).

## Daily loop

```bash
pnpm db:start          # local Supabase in Docker (Postgres, Auth, Data API, Mailpit inbox)
pnpm db:env            # first time only: writes .env.local with the local stack's keys
pnpm dev               # http://localhost:3000
```

Emails sent by the local stack (confirmation, password reset) appear in Mailpit at
<http://127.0.0.1:54324>.

Before pushing:

```bash
pnpm check             # lint + typecheck + format + unit tests + build
pnpm db:test           # pgTAP security tests
pnpm test:integration  # Auth and Data API denial tests
pnpm test:e2e          # browser journeys (after `pnpm build`)
```

## Changing the database

1. Create a migration with `pnpm exec supabase migration new <name>` and write the SQL.
   - Grant only what the feature needs: nothing in `public` is accessible by default.
   - Enable RLS on every new table, or `001_schema_guarantees` fails.
2. Run `pnpm db:reset` to rebuild the local database from all migrations plus `supabase/seed.sql`.
3. Run `pnpm db:types` to regenerate `src/lib/supabase/database.types.ts`. CI fails if it is stale.
4. Add or extend the pgTAP tests in `supabase/tests/` and the integration tests.

## Demo accounts (local)

```bash
DEMO_ACCOUNT_PASSWORD='choose-one-123' pnpm seed:demo
```

This creates five fictional accounts: two students, electrical and IT staff, and an admin. The
script is idempotent, and re-running it resets their roles and password.

## Troubleshooting

- **`ConfigError: Invalid server configuration`**: a variable in `.env.local` is missing or
  invalid. The error lists the names, never the values. Regenerate it with
  `pnpm db:env --force`.
- **"must be the publishable key, not a secret key"**: a secret key was put in
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Use the publishable key there.
- **`supabase` commands fail to parse `.env.local`**: the file was saved with a byte-order mark.
  Regenerate it with `pnpm db:env --force`.
- **A style change does not appear in `pnpm build` / `pnpm start`**: the incremental build cache
  can keep a stale stylesheet. Delete `.next` and build again. CI always builds from scratch.
- **Account-creating E2E tests are skipped**: they only run against a local stack, with
  `SUPABASE_SECRET_KEY` set and `PLAYWRIGHT_BASE_URL` unset.

## AI triage locally (Phase 4)

- **Off by default.** With `AI_ENABLED=false`, tickets wait for manual routing.
- **E2E needs no key.** It starts a second server on port 3101 with AI on, talking to the local
  Gemini stub (`tests/support/gemini-stub.mts`, port 3199). Markers such as `STUB:429` in a
  report script failures; see the stub's header.
- **Live evaluation** (uses your free-tier quota):
  1. Put `GEMINI_API_KEY=...` in `.env.local` with an editor. Never type it on the command line.
  2. Run `EVAL_LIMIT=3 pnpm eval:agent` to smoke-test the key, the model and tool calling.
  3. Run `pnpm eval:agent` for the 30 held-out reports. The report is written to
     `docs/evidence/p4-agent-eval-eval.md`.
- **AI in the dev server:** set `AI_ENABLED=true` and the key in `.env.local`, then restart
  `pnpm dev`.
