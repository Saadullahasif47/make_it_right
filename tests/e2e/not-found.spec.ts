import { expect, test } from "@playwright/test";

test("unknown routes show a branded 404 with a way back", async ({ page }) => {
  const response = await page.goto("/this-page-does-not-exist");

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This page does not exist" })).toBeVisible();

  await page.getByRole("link", { name: "Back to home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("fixed right");
});

test("unknown API routes return 404, not an HTML crash page", async ({ request }) => {
  const response = await request.get("/api/does-not-exist");
  expect(response.status()).toBe(404);
});
