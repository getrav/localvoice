import { test, expect } from "@playwright/test";
import { installApiMocks, openTab, CANONICAL_SYNC_STATUSES, expectVisualSnapshot } from "./test-helpers";

test.describe("Sync Status", () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/");
    await openTab(page, "sync");
  });

  test("matches visual snapshot", async ({ page }) => {
    await expect(page.locator("#sync-table-body tr").first()).toBeVisible();
    await expectVisualSnapshot(page, "sync-tab.png", ["#sync-countdown", "#sync-last-time"]);
  });

  test("renders action buttons for each status", async ({ page }) => {
    for (const status of CANONICAL_SYNC_STATUSES) {
      await page.selectOption("#sync-status-filter", status);
      await expect(page.locator("#sync-table-body tr").first()).toBeVisible(); // Wait for table to re-render and be populated

      const firstRow = page.locator("#sync-table-body tr").first();
      if (status === "pending") {
        await expect(firstRow.locator(".btn-action[data-action='download']")).toHaveText("Download");
      } else if (status === "downloaded") {
        await expect(firstRow.locator(".btn-action[data-action='transcribe']")).toHaveText("Transcribe");
      } else if (status === "transcribed") {
        await expect(firstRow.locator(".btn-action[data-action='retranscribe']")).toBeVisible();
        await expect(firstRow.locator(".btn-action[data-action='retransliterate']")).toBeVisible();
      } else if (status === "error") {
        await expect(firstRow.locator(".btn-action[data-action='retranscribe']")).toHaveText("Reprocess");
      } else {
        throw new Error(`Unexpected sync status: ${status}`);
      }
    }
  });

  test("clicking Download advances row to show Transcribe next", async ({ page }) => {
    await page.selectOption("#sync-status-filter", "pending");
    await expect(page.locator("#sync-table-body tr").first()).toBeVisible(); // Wait for table to be populated

    const firstRowIdLocator = page.locator("#sync-table-body tr:first-child td:first-child");
    const firstRowId = (await firstRowIdLocator.textContent())?.trim();
    expect(firstRowId).toBeDefined();

    const firstRowActionButton = page.locator("#sync-table-body tr:first-child .btn-action");
    await expect(firstRowActionButton).toHaveText("Download");
    await firstRowActionButton.click();

    await page.waitForLoadState("networkidle"); // Wait for API call and UI update

    // After clicking download, the status should change to downloaded, and the button should be Transcribe
    await page.selectOption("#sync-status-filter", "downloaded"); // Re-filter to see the updated row
    const downloadedRowLocator = page.locator(`#sync-table-body tr:has(td:text-is("${firstRowId}"))`);
    await expect(downloadedRowLocator).toBeVisible(); // Ensure the specific row is visible

    const downloadedRowActionButton = downloadedRowLocator.locator(".btn-action[data-action='transcribe']");
    await expect(downloadedRowActionButton).toHaveText("Transcribe");
  });

  test("clicking Transcribe advances row to show Retranscribe next", async ({ page }) => {
    await page.selectOption("#sync-status-filter", "downloaded");
    await expect(page.locator("#sync-table-body tr").first()).toBeVisible(); // Wait for table to be populated

    const firstRowIdLocator = page.locator("#sync-table-body tr:first-child td:first-child");
    const firstRowId = (await firstRowIdLocator.textContent())?.trim();
    expect(firstRowId).toBeDefined();

    const firstRowActionButton = page.locator("#sync-table-body tr:first-child .btn-action");
    await expect(firstRowActionButton).toHaveText("Transcribe");

    await firstRowActionButton.click();
    await page.waitForLoadState("networkidle"); // Wait for API call and UI update

    // After clicking transcribe, the status should change to transcribed, and the button should be Retranscribe
    await page.selectOption("#sync-status-filter", "transcribed"); // Re-filter to see the updated row
    const transcribedRowLocator = page.locator(`#sync-table-body tr:has(td:text-is("${firstRowId}"))`);
    await expect(transcribedRowLocator).toBeVisible(); // Ensure the specific row is visible

    await expect(transcribedRowLocator).toContainText("Retranscribe");
    const retransliterateButton = transcribedRowLocator.locator(".btn-action[data-action='retransliterate']");
    const retranscribeButton = transcribedRowLocator.locator(".btn-action[data-action='retranscribe']");
    await expect(retranscribeButton).toBeVisible();
    await expect(retransliterateButton).toBeVisible();
  });

  test("bulk retranscribe: cancel confirm triggers no POST /api/recordings/bulk-action", async ({ page }) => {
    let bulkActionPostCount = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/recordings/bulk-action")) {
        bulkActionPostCount++;
      }
    });

    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Are you sure you want to retranscribe");
      expect(dialog.message()).toContain("status");
      await dialog.dismiss();
    });

    await page.locator("#sync-bulk-retranscribe").click();

    // Wait for any potential network activity to settle
    await page.waitForLoadState("networkidle");

    expect(bulkActionPostCount).toBe(0);
  });

  test("empty state shows Refresh CTA and clicking triggers another GET /api/sync/recordings", async ({ page }) => {
    let syncRecordingsGetCount = 0;

    // Override the beforeEach for this specific test
    await installApiMocks(page, {
      handlers: {
        "GET /api/sync/recordings": async (route) => {
          syncRecordingsGetCount++;
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ total: 0, recordings: [] }) });
        },
      },
    });
    await page.goto("/");
    await openTab(page, "sync");

    const initialSyncRecordingsGetCount = syncRecordingsGetCount;
    expect(syncRecordingsGetCount).toBe(initialSyncRecordingsGetCount); // Initial load after custom mocks

    await expect(page.locator("#sync-empty-refresh")).toBeVisible();
    await page.locator("#sync-empty-refresh").click();

    await page.waitForLoadState("networkidle");

    expect(syncRecordingsGetCount).toBe(initialSyncRecordingsGetCount + 1);
  });
});
