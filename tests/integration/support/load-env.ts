import { existsSync } from "node:fs";

// CI exports the local stack's variables directly; developers keep them in .env.local.
if (process.env.SUPABASE_SECRET_KEY === undefined && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}
