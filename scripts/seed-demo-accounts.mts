/**
 * Creates or refreshes the fictional demo accounts (master plan P1.03, P1.08, P7.02).
 *
 * Roles are assigned here, with the project's secret key, because the application offers no
 * way to promote an account: signup always creates a student. No password is stored in the
 * repository; it is read from DEMO_ACCOUNT_PASSWORD at run time.
 *
 *   DEMO_ACCOUNT_PASSWORD=... pnpm seed:demo
 */
import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/lib/supabase/database.types.ts";

type Role = "student" | "department" | "admin";

interface DemoAccount {
  readonly email: string;
  readonly displayName: string;
  readonly role: Role;
  readonly departmentCode?: string;
}

const ACCOUNTS: readonly DemoAccount[] = [
  { email: "student.one@makeitright.test", displayName: "Demo Student One", role: "student" },
  { email: "student.two@makeitright.test", displayName: "Demo Student Two", role: "student" },
  {
    email: "electrical.staff@makeitright.test",
    displayName: "Demo Electrical Staff",
    role: "department",
    departmentCode: "electrical",
  },
  {
    email: "it.staff@makeitright.test",
    displayName: "Demo IT Staff",
    role: "department",
    departmentCode: "it_services",
  },
  { email: "admin@makeitright.test", displayName: "Demo Administrator", role: "admin" },
];

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") {
    console.error(`Missing ${name}.`);
    process.exit(1);
  }
  return value;
}

const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const secretKey = requireEnv("SUPABASE_SECRET_KEY");
const password = requireEnv("DEMO_ACCOUNT_PASSWORD");

if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
  console.error("DEMO_ACCOUNT_PASSWORD must have at least 10 characters, with letters and digits.");
  process.exit(1);
}

const admin = createClient<Database>(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserId(email: string): Promise<string | undefined> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error !== null) {
      throw new Error(`Could not list users: ${error.message}`);
    }
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match !== undefined) {
      return match.id;
    }
    if (data.users.length < 200) {
      return undefined;
    }
  }
  return undefined;
}

async function departmentIdFor(code: string): Promise<string> {
  const { data, error } = await admin.from("departments").select("id").eq("code", code).single();
  if (error !== null) {
    throw new Error(`Department "${code}" not found. Has supabase/seed.sql been applied?`);
  }
  return data.id;
}

async function upsertAccount(account: DemoAccount): Promise<void> {
  const existingId = await findUserId(account.email);
  let userId = existingId;

  if (userId === undefined) {
    const { data, error } = await admin.auth.admin.createUser({
      email: account.email,
      password,
      email_confirm: true,
      user_metadata: { display_name: account.displayName },
    });
    if (error !== null) {
      throw new Error(`Could not create ${account.email}: ${error.message}`);
    }
    userId = data.user.id;
  } else {
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });
    if (error !== null) {
      throw new Error(`Could not update ${account.email}: ${error.message}`);
    }
  }

  const departmentId =
    account.departmentCode === undefined ? null : await departmentIdFor(account.departmentCode);
  const { error: profileError } = await admin
    .from("profiles")
    .update({ role: account.role, department_id: departmentId, display_name: account.displayName })
    .eq("id", userId);
  if (profileError !== null) {
    throw new Error(`Could not assign role for ${account.email}: ${profileError.message}`);
  }

  console.log(
    `${existingId === undefined ? "created" : "updated"}  ${account.role.padEnd(10)} ${account.email}`,
  );
}

for (const account of ACCOUNTS) {
  await upsertAccount(account);
}
console.log(
  `Done. ${ACCOUNTS.length} demo accounts share the password from DEMO_ACCOUNT_PASSWORD.`,
);
