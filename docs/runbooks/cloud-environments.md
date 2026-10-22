# Runbook: cloud environments (Supabase + Vercel)

| Item             | Value                                                                   |
| ---------------- | ----------------------------------------------------------------------- |
| Supabase project | `makeitright-staging`, ref `ijmikxhkyrensmsnmvmb`, Free plan            |
| Supabase URL     | `https://ijmikxhkyrensmsnmvmb.supabase.co`                              |
| Used by          | Vercel previews **and** production until Phase 7 (ADR 0002)             |
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

Never add `SUPABASE_SECRET_KEY` to Vercel: the application does not use it.

## Demo accounts on the cloud project

Run from the owner's machine with the secret key in the shell only (not in a file):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://ijmikxhkyrensmsnmvmb.supabase.co \
SUPABASE_SECRET_KEY='sb_secret_…' DEMO_ACCOUNT_PASSWORD='…' \
node scripts/seed-demo-accounts.mts
```
