import { join } from "node:path";

import { expect, type Browser, type Page } from "@playwright/test";

import { AI_PORT } from "../../../playwright.config";
import { adminClient, type TestUser } from "../../integration/support/supabase";

import { signIn } from "./local-stack";

/** The second test server, where the add-on features are switched on. */
export const FLAGGED_URL = `http://localhost:${String(AI_PORT)}`;
const FIXTURES = join(process.cwd(), "tests", "fixtures", "evidence");

export async function signedIn(
  browser: Browser,
  baseURL: string,
  user: TestUser,
  home: RegExp,
): Promise<Page> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto("/login");
  await signIn(page, user.email, user.password);
  await expect(page).toHaveURL(home);
  return page;
}

/**
 * Submits a text-only report through the real form and returns the ticket id. `note` is
 * appended to the description; the Gemini stub reads STUB: markers there.
 */
export async function report(page: Page, note = ""): Promise<string> {
  await page.goto("/student/complaints/new");
  await page.getByLabel("What is wrong?").fill("Water under the washroom sink");
  await page.getByLabel("Building").fill("Block E");
  await page
    .getByLabel("Describe the problem")
    .fill(
      `There is a puddle of water under the sink cabinet in the ground floor washroom. ${note}`,
    );
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page).toHaveURL(/\/student\/complaints\/[0-9a-f-]{36}\?notice=/, {
    timeout: 20_000,
  });
  return new URL(page.url()).pathname.split("/").at(-1) ?? "";
}

/** Picks a fixture through the real file chooser behind "Add a photo". */
export async function choosePhoto(page: Page, file: string): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add a photo" }).click();
  await (await chooser).setFiles(join(FIXTURES, file));
}

/** The ticket's photos and their AI jobs, read with the secret key. */
export async function photoJobsFor(ticketId: string) {
  const { data } = await adminClient()
    .from("evidence_attachments")
    .select("id, state")
    .eq("complaint_id", ticketId);
  const finalized = (data ?? []).filter((row) => row.state === "finalized").map((row) => row.id);
  const { data: jobs } = await adminClient()
    .from("ai_jobs")
    .select("id, status, target_id")
    .in("target_id", finalized.length === 0 ? ["00000000-0000-4000-8000-000000000000"] : finalized);
  return { attachments: data ?? [], jobs: jobs ?? [] };
}
