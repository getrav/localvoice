import { test, expect } from "@playwright/test";
import { installApiMocks, openTab, attachAudioFile } from "./test-helpers";

test.describe("Speakers Tab", () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/");
    await openTab(page, "speakers");
  });

  test("1. Happy: default mocked speakers list renders at least 1 .speaker-card and Delete button", async ({ page }) => {
    const speakersList = page.locator("#speakers-list");
    await expect(speakersList).toBeVisible();

    const speakerCards = page.locator(".speaker-card");
    await expect(speakerCards.first()).toBeVisible();
    await expect(speakerCards).toHaveCount(1);
    
    await expect(speakerCards.first().locator(".speaker-name")).toHaveText("Alice");
    await expect(speakerCards.first().locator(".speaker-delete")).toBeVisible();
  });

  test("2. Empty state: empty CTA button focuses #enroll-name", async ({ page }) => {
    await installApiMocks(page, {
      handlers: {
        "GET /api/speakers": async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ speakers: [] })
          });
        }
      }
    });

    await page.reload();
    await openTab(page, "speakers");

    const speakersList = page.locator("#speakers-list");
    await expect(speakersList).toBeVisible();
    await expect(page.locator(".speaker-card")).toHaveCount(0);

    const emptyCta = page.locator("#speakers-empty-enroll");
    await expect(emptyCta).toBeVisible();
    
    await emptyCta.click();
    await expect(page.locator("#enroll-name")).toBeFocused();
  });

  test("3. Enroll success: fills form, attaches file, asserts success message", async ({ page }) => {
    await page.locator("#enroll-name").fill("John Doe");
    await attachAudioFile(page, "#enroll-file");

    const enrollSubmit = page.locator("#enroll-submit");
    await expect(enrollSubmit).toBeEnabled();
    await enrollSubmit.click();

    const enrollResult = page.locator("#enroll-result");
    await expect(enrollResult).toBeVisible();
    await expect(enrollResult).toContainText("Enrolled");
  });

  test("4. Enroll error focus: failure triggers catch and focuses #enroll-result", async ({ page }) => {
    await installApiMocks(page, {
      handlers: {
        "POST /api/speakers/enroll": async (route) => {
          await route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({ error: "Invalid audio format" })
          });
        }
      }
    });

    await page.locator("#enroll-name").fill("John Doe");
    await attachAudioFile(page, "#enroll-file");

    const enrollSubmit = page.locator("#enroll-submit");
    await enrollSubmit.click();

    const enrollResult = page.locator("#enroll-result");
    await expect(enrollResult).toBeVisible();
    await expect(enrollResult).toContainText("Invalid audio format");
    await expect(enrollResult).toBeFocused();
  });

  test("5. Delete cancel: dismisses dialog and asserts no DELETE request", async ({ page }) => {
    let deleteRequestMade = false;
    
    await installApiMocks(page, {
      handlers: {
        "DELETE /api/speakers/speaker-1": async (route) => {
          deleteRequestMade = true;
          await route.continue();
        }
      }
    });

    page.once("dialog", (dialog) => dialog.dismiss());

    const deleteBtn = page.locator(".speaker-card").first().locator(".speaker-delete");
    await expect(deleteBtn).toBeVisible();
    
    await deleteBtn.click();
    
    expect(deleteRequestMade).toBe(false);
  });
});
