import { expect, type Page } from "@playwright/test";

/**
 * Account-creating specs run only against a local Supabase stack, never a cloud project:
 * they need the secret key, and test data must never land in shared environments.
 */
export function hasLocalStack(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url);
  return (
    local &&
    (process.env.SUPABASE_SECRET_KEY ?? "") !== "" &&
    process.env.PLAYWRIGHT_BASE_URL === undefined
  );
}

export const LOCAL_STACK_REASON =
  "needs the local Supabase stack (pnpm db:start) and a local app build";

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Mailpit (the local stack's inbox): returns the first link in the newest email to `to`. */
export async function latestEmailLink(to: string, linkPattern: RegExp): Promise<string> {
  const mailpit = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
  let href: string | undefined;

  await expect
    .poll(
      async () => {
        const search = await fetch(
          `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=1`,
        );
        const result = (await search.json()) as { messages?: { ID: string }[] };
        const id = result.messages?.[0]?.ID;
        if (id === undefined) return false;

        const message = (await (await fetch(`${mailpit}/api/v1/message/${id}`)).json()) as {
          HTML?: string;
        };
        const match = (message.HTML ?? "").match(/href="([^"]+)"/);
        href = match?.[1]?.replaceAll("&amp;", "&");
        return href !== undefined && linkPattern.test(href);
      },
      { timeout: 15_000, message: `no email with a matching link reached ${to}` },
    )
    .toBe(true);

  if (href === undefined) throw new Error("unreachable");
  return href;
}
