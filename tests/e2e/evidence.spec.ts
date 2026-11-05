/**
 * Photo evidence and the AI jobs panel (plan v2 A1.01-A1.04), on desktop and phone.
 * The second test server has FEATURE_VISUAL_INSPECTION on; the first has every flag off and
 * must look exactly as before.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  adminClient,
  createTestUser,
  deleteUsers,
  type TestUser,
} from "../integration/support/supabase";

import { FLAGGED_URL, choosePhoto, photoJobsFor, report, signedIn } from "./support/evidence";
import { LOCAL_STACK_REASON, hasLocalStack } from "./support/local-stack";
import { runWorker } from "./support/worker";

test.skip(!hasLocalStack(), LOCAL_STACK_REASON);

const cleanup: string[] = [];
let student: TestUser;
let admin: TestUser;

test.beforeAll(async () => {
  [student, admin] = await Promise.all([createTestUser("student"), createTestUser("admin")]);
  cleanup.push(student.id, admin.id);
});

test.afterAll(async () => {
  await deleteUsers(cleanup);
});

test.describe("with photo evidence switched on", () => {
  test.use({ baseURL: FLAGGED_URL });

  test("a reporter adds a photo to a saved report and its analysis is queued", async ({
    browser,
  }) => {
    const page = await signedIn(browser, FLAGGED_URL, student, /\/student\/complaints$/);
    const ticketId = await report(page);

    const photos = page.getByRole("region", { name: "Photos" });
    await expect(photos.getByText("No photos yet.")).toBeVisible();
    await choosePhoto(page, "synthetic-sink.png");

    await expect(photos.getByText("Photo added. It will be analysed shortly.")).toBeVisible();
    const thumbnail = photos.getByRole("img", { name: "Photo 1 attached to this report" });
    await expect(thumbnail).toBeVisible();
    // The image is served from the private bucket through a short-lived signed URL.
    expect(await thumbnail.getAttribute("src")).toMatch(
      /\/storage\/v1\/object\/sign\/complaint-evidence\//,
    );
    await expect
      .poll(async () => await thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBe(240);

    // One job, queued at finalise time. (The parallel run's worker call may already have
    // picked it up; the integration suite checks the exact "queued" state.)
    const { attachments, jobs } = await photoJobsFor(ticketId);
    expect(attachments).toEqual([expect.objectContaining({ state: "finalized" })]);
    expect(jobs).toHaveLength(1);

    const scan = await new AxeBuilder({ page }).include("main").analyze();
    expect(scan.violations).toEqual([]);
    await page.context().close();
  });

  test("a file that is not really an image is refused and the report stays intact", async ({
    browser,
  }) => {
    const page = await signedIn(browser, FLAGGED_URL, student, /\/student\/complaints$/);
    const ticketId = await report(page);

    await choosePhoto(page, "not-an-image.png");
    const photos = page.getByRole("region", { name: "Photos" });
    await expect(
      photos.getByText("That file is not a usable photo.", { exact: false }),
    ).toBeVisible();

    const { attachments, jobs } = await photoJobsFor(ticketId);
    expect(attachments).toEqual([expect.objectContaining({ state: "rejected" })]);
    expect(jobs).toEqual([]);
    // The text report itself is untouched.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Water under the washroom sink" }),
    ).toBeVisible();
    await page.context().close();
  });

  test("an admin sees the job, its failure reason, and can retry it", async ({ browser }) => {
    const studentPage = await signedIn(browser, FLAGGED_URL, student, /\/student\/complaints$/);
    // The stub answers this photo with malformed output, so the job ends in review.
    const ticketId = await report(studentPage, "STUB:VISION-INVALID");
    await choosePhoto(studentPage, "synthetic-sink.png");
    await expect(studentPage.getByText("Photo added.", { exact: false })).toBeVisible();
    await studentPage.context().close();

    const [job] = (await photoJobsFor(ticketId)).jobs;
    expect(job).toBeDefined();
    const jobId = job?.id ?? "";

    // The worker runs (as Cron would); the photo's analysis is invalid, so the job goes to review.
    await expect
      .poll(
        async () => {
          await runWorker();
          return (await photoJobsFor(ticketId)).jobs[0]?.status;
        },
        { timeout: 30_000 },
      )
      .toBe("needs_review");

    const page = await signedIn(browser, FLAGGED_URL, admin, /\/admin$/);
    await page
      .getByRole("navigation", { name: "Workspace" })
      .getByRole("link", { name: /AI jobs|Jobs/ })
      .click();
    await expect(page).toHaveURL(/\/admin\/jobs$/);
    await page.getByRole("link", { name: /^Needs review/ }).click();

    const row = page.getByRole("row").filter({ hasText: jobId.slice(0, 8) });
    await expect(row.getByText("Photo analysis")).toBeVisible();
    await expect(row.getByText("The AI's answer was not in the expected form.")).toBeVisible();

    const scan = await new AxeBuilder({ page }).include("main").analyze();
    expect(scan.violations).toEqual([]);

    await row.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText("Job queued again.", { exact: false })).toBeVisible();
    const { data: retried } = await adminClient()
      .from("ai_jobs")
      .select("admin_retries")
      .eq("id", jobId)
      .single();
    expect(retried?.admin_retries).toBe(1);
    await page.context().close();
  });
});

test.describe("with every feature flag off", () => {
  test("nothing of the add-on is visible or reachable", async ({ browser, baseURL }) => {
    const origin = baseURL ?? "";
    const page = await signedIn(browser, origin, student, /\/student\/complaints$/);
    const ticketId = await report(page);
    await expect(page.getByRole("region", { name: "Photos" })).toHaveCount(0);

    const reserved = await page.request.post(`/api/complaints/${ticketId}/photos`, {
      data: { mimeType: "image/png", byteSize: 100 },
      headers: { origin },
    });
    expect(reserved.status()).toBe(404);
    await page.context().close();

    const adminPage = await signedIn(browser, origin, admin, /\/admin$/);
    await expect(
      adminPage
        .getByRole("navigation", { name: "Workspace" })
        .getByRole("link", { name: /AI jobs|Jobs/ }),
    ).toHaveCount(0);
    await adminPage.goto("/admin/jobs");
    await expect(
      adminPage.getByRole("heading", { name: "This page does not exist" }),
    ).toBeVisible();
    await adminPage.context().close();
  });
});
