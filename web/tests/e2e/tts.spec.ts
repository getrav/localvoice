import { test, expect } from "@playwright/test";
import { installApiMocks, openTab } from "./test-helpers";

test.describe("TTS Tab", () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/");
    await openTab(page, "tts");
  });

  test("happy path: generates speech successfully", async ({ page }) => {
    await page.fill("#tts-text", "Hello world");
    await page.click("#tts-generate");

    await expect(page.locator("#tts-result")).toBeVisible();
    await expect(page.locator("#tts-audio")).toHaveAttribute("src", /^blob:/);
  });

  test("loading state: shows and hides loading indicator", async ({ page }) => {
    let resolveRequest: () => void;
    const requestPromise = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    });

    await installApiMocks(page, {
      handlers: {
        "POST /api/tts": async (route) => {
          await requestPromise;
          await route.fulfill({ status: 200, contentType: "audio/wav", body: Buffer.from("fake audio") });
        },
      },
    });

    await page.fill("#tts-text", "Delay test");
    // Do not await the click immediately, just trigger it
    await page.click("#tts-generate", { noWaitAfter: true });

    // Assert loading is visible
    await expect(page.locator("#tts-loading")).toBeVisible();
    
    // Resolve the request to finish the mock
    resolveRequest!();
    
    // Assert loading hides and result shows
    await expect(page.locator("#tts-loading")).toBeHidden();
    await expect(page.locator("#tts-result")).toBeVisible();
  });

  test("error handling: shows error message and focuses it", async ({ page }) => {
    await installApiMocks(page, {
      handlers: {
        "POST /api/tts": async (route) => {
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "Something went wrong" }),
          });
        },
      },
    });

    await page.fill("#tts-text", "Error test");
    await page.click("#tts-generate");

    const errorEl = page.locator("#tts-error");
    await expect(errorEl).toBeVisible();
    await expect(errorEl).toHaveText("Something went wrong");
    await expect(errorEl).toBeFocused();
  });

  test("edge cases: sends correct request body and toggles engine UI", async ({ page }) => {
    let requestBody: any;
    await installApiMocks(page, {
      handlers: {
        "POST /api/tts": async (route) => {
          requestBody = JSON.parse(route.request().postData() || "{}");
          await route.fulfill({ status: 200, contentType: "audio/wav", body: Buffer.from("fake audio") });
        },
      },
    });

    // Kokoro is selected by default
    await page.fill("#tts-text", "Testing Kokoro");
    // Wait for voice dropdown to populate with our mock voices
    await expect(page.locator("#tts-voice")).toHaveValue("af_heart");
    await page.click("#tts-generate");

    await expect.poll(() => requestBody).toEqual({
      text: "Testing Kokoro",
      engine: "kokoro",
      voice: "af_heart",
    });

    // Switch to Piper
    await page.locator('input[name="tts-engine"][value="piper"]').check();
    
    // Kokoro voice group should be hidden
    await expect(page.locator("#kokoro-voice-group")).toBeHidden();

    // Generate again with Piper
    await page.fill("#tts-text", "Testing Piper");
    await page.click("#tts-generate");

    await expect.poll(() => requestBody).toEqual({
      text: "Testing Piper",
      engine: "piper",
    });
  });

  test("keyboard navigation: triggers generation on Enter key", async ({ page }) => {
    let requestMade = false;
    await installApiMocks(page, {
      handlers: {
        "POST /api/tts": async (route) => {
          requestMade = true;
          await route.fulfill({ status: 200, contentType: "audio/wav", body: Buffer.from("fake audio") });
        },
      },
    });

    await page.fill("#tts-text", "Keyboard test");
    
    // Focus the generate button and press Enter
    await page.focus("#tts-generate");
    await page.keyboard.press("Enter");

    await expect.poll(() => requestMade).toBe(true);
    await expect(page.locator("#tts-result")).toBeVisible();
  });
});
