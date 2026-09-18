/**
 * G-28 — e2e smoke. Two assertions that catch the failures that matter most:
 * the shell renders with the pipeline visible, and the studio is reachable
 * from the home page (no dead entry links). The forge pill may read "online"
 * (sidecar up) or "unreachable" (cold environment) — both are valid renders;
 * what must never happen is a crashed route.
 */
import { expect, test } from "@playwright/test";

test.describe("G-28 e2e smoke", () => {
  test("home renders the KDP pipeline and links into the studio", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("forge-status")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Forge books");
    for (const stage of ["Draft", "Humanize", "Format", "Validate", "Export"]) {
      await expect(page.getByText(stage, { exact: true })).toBeVisible();
    }
    const studio = page.getByTestId("open-studio");
    await expect(studio).toBeVisible();
    await studio.click();
    await expect(page).toHaveURL(/\/studio$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("studio library responds even when the forge is unreachable", async ({ page }) => {
    const response = await page.goto("/studio");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
