import { test, expect, type Page } from "@playwright/test";
import { installApiMocks, expectVisualSnapshot } from "./test-helpers";

async function boot(page: Page, overrides?: Parameters<typeof installApiMocks>[1]) {
  await installApiMocks(page, overrides);
  await page.goto("/");
}

test.describe("Recordings", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
  });

  test("matches visual snapshot", async ({ page }) => {
    await expect(page.locator("#recordings-body tr").first()).toBeVisible();
    await expectVisualSnapshot(page, "recordings-tab.png");
  });

  test("loads recordings and renders rows", async ({ page }) => {
    await expect(page.locator("#recordings-table")).toBeVisible();
    await expect(page.locator("#recordings-body tr").first()).toBeVisible();
  });

  test("clicking Next fetches next page and updates page label", async ({ page }) => {
    let recordingsGetCount = 0;
    page.on("request", (request) => {
      if (request.method() === "GET" && request.url().includes("/api/recordings")) {
        recordingsGetCount++;
      }
    });

    await expect(page.locator("#recordings-body tr").first()).toBeVisible();
    const before = recordingsGetCount;

    await page.locator("#next-page").click();
    await expect(page.locator("#page-info")).toHaveText("Page 2");

    await expect.poll(() => recordingsGetCount).toBeGreaterThan(before);
  });

  test("changing page size resets to Page 1 and refetches", async ({ page }) => {
    let recordingsGetCount = 0;
    page.on("request", (request) => {
      if (request.method() === "GET" && request.url().includes("/api/recordings")) {
        recordingsGetCount++;
      }
    });

    await expect(page.locator("#recordings-body tr").first()).toBeVisible();

    await page.locator("#next-page").click();
    await expect(page.locator("#page-info")).toHaveText("Page 2");

    const before = recordingsGetCount;
    await page.selectOption("#page-size", "10");
    await expect(page.locator("#page-info")).toHaveText("Page 1");

    await expect.poll(() => recordingsGetCount).toBeGreaterThan(before);
  });

  test("clicking a row expands and shows audio player", async ({ page }) => {
    const firstRow = page.locator("#recordings-body tr").first();
    const id = (await firstRow.locator("td").nth(1).textContent())?.trim();
    expect(id).toBeTruthy();

    await firstRow.click();

    const detailRow = page.locator("#recordings-body tr.detail-row");
    await expect(detailRow).toHaveCount(1);
    await expect(detailRow.first().locator(`audio[src='/api/recordings/${id}/audio']`)).toBeVisible();

    await firstRow.click();
    await expect(detailRow).toHaveCount(0);
  });

  test("error state shows an error message row", async ({ page }) => {
    await boot(page, {
      handlers: {
        "GET /api/recordings": async (route) => {
          await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) });
        },
      },
    });

    await expect(page.locator("#recordings-body")).toContainText("Error loading recordings");
  });
});
