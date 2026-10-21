# Runbook: local development

## One-time setup

1. Install Node.js 24 LTS, then run `corepack enable` so pnpm 11.5.1 (pinned in
   `package.json`) is used.
2. Clone, then run `pnpm install`.
3. Run `cp .env.example .env.local`. Phase 0 needs no secrets: every value has a safe default.
4. Run `pnpm exec playwright install chromium` (only needed for E2E tests).

## Daily loop

```bash
pnpm dev            # http://localhost:3000
pnpm check          # lint + typecheck + format + unit tests + build: run before every push
pnpm test:e2e       # after `pnpm build`; starts `pnpm start` on port 3100 automatically
```

## Verifying a clean checkout (Gate P0)

```bash
git clone https://github.com/Saadullahasif47/make_it_right.git && cd make_it_right
pnpm install --frozen-lockfile
pnpm check
pnpm test:e2e
```

## Troubleshooting

- **`ConfigError: Invalid server configuration`** at startup: a variable in `.env.local` has
  an invalid value. The error lists the variable names (never their values). Compare them with
  `.env.example`.
- **`/api/health` returns 503**: the same configuration problem on a deployed environment.
  Check the Vercel project's environment variables.
- **E2E cannot start the server**: run `pnpm build` first, and make sure port 3100 is free.
