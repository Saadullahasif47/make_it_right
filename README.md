# MakeItRight

**AI Cloud-Based University Complaint System**, a cloud computing coursework prototype.

Students report campus maintenance problems (electrical, IT equipment, plumbing, furniture,
sanitation, other). Departments work on the tickets assigned to them, and admins track progress.
A bounded AI agent suggests a category and department and routes only routine tickets.

> **Prototype notice.** This is not an official university reporting channel. Use fictional
> accounts and complaints only. Do not submit real personal, harassment, medical, disciplinary or
> emergency reports. Free-tier AI inputs may be used by the provider to improve its products.

## Stack

| Layer         | Choice                                                             |
| ------------- | ------------------------------------------------------------------ |
| App and API   | Next.js 16 App Router, TypeScript (strict), Tailwind CSS 4         |
| Hosting       | Vercel Hobby (serverless functions + CDN)                          |
| Data and auth | Supabase PostgreSQL, Auth and row-level security _(from Phase 1)_  |
| AI            | Gemini API through a server-only tool adapter _(from Phase 4)_     |
| Validation    | Zod                                                                |
| Tests         | Vitest + Testing Library, Playwright + axe-core, SQL tests _(P1+)_ |
| CI            | GitHub Actions + pnpm                                              |

Design decisions are recorded in [`docs/adr/`](docs/adr). Progress against the master plan is
tracked in [`docs/progress-tracker.md`](docs/progress-tracker.md).

## Getting started

Requirements: Node.js 24 LTS and pnpm 11 (`corepack enable` selects the pinned version).

```bash
pnpm install
cp .env.example .env.local   # then edit; never commit .env.local
pnpm dev                     # http://localhost:3000
```

See the [local development runbook](docs/runbooks/local-development.md) for details.

## Scripts

| Command             | What it does                                                     |
| ------------------- | ---------------------------------------------------------------- |
| `pnpm dev`          | Start the development server                                     |
| `pnpm lint`         | ESLint with type-aware rules; any warning fails                  |
| `pnpm typecheck`    | Generate route types, then `tsc --noEmit`                        |
| `pnpm format:check` | Prettier check (`pnpm format` to fix)                            |
| `pnpm test`         | Unit and component tests (Vitest)                                |
| `pnpm build`        | Production build                                                 |
| `pnpm test:e2e`     | Playwright against the production build (run `pnpm build` first) |
| `pnpm check`        | lint + typecheck + format + unit tests + build                   |

To run the E2E suite against a deployed preview instead of a local build:

```bash
PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app pnpm test:e2e
```

## Project layout

```
src/
  app/                 routes only: pages and route handlers orchestrate, they hold no business logic
    (public)/          landing page and sign-in
    api/health/        GET /api/health liveness probe
  components/          reusable presentation components
  features/            domain modules (complaints, auth, agent, health)
  lib/config/          the only place process.env is read, validated with Zod
  lib/logging/         structured JSON logger with redaction, request IDs
  lib/http/            the public API error catalog and response helpers
supabase/              SQL migrations, seed and database tests (Phase 1+)
tests/unit|integration|e2e
docs/adr|runbooks|evidence
```

## Engineering rules

The [master plan](docs/adr/0001-stack-and-repository-structure.md#source-of-truth) is the
specification. In short:

- Strict TypeScript, no `any`, no unexplained lint suppressions, no scattered `process.env`.
- Authorization is enforced by the database (RLS and audited SQL functions) **and** the server.
- A ticket is saved before any AI call. AI output is untrusted and the app works without it.
- Every change leaves lint, typecheck, tests and build green.
