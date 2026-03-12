import { test, expect } from "@playwright/test";
import { installApiMocks, openTab, attachAudioFile } from "./test-helpers";

test.describe("STT Tab", () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/");
    await openTab(page, "stt");
  });

  test("happy: file + Transcribe -> shows output", async ({ page }) => {
    await attachAudioFile(page, "#stt-file");
    
    await expect(page.locator("#stt-file-info")).toBeVisible();
    await expect(page.locator("#stt-filename")).toHaveText("sample.wav");
    await expect(page.locator("#stt-transcribe")).toBeEnabled();

    await page.locator("#stt-transcribe").click();

    await expect(page.locator("#stt-result")).toBeVisible();
    await expect(page.locator("#stt-text")).toHaveValue("Mock transcription output");
  });

  test("loading: shows loading indicator during transcription", async ({ page }) => {
    await installApiMocks(page, {
      handlers: {
        "POST /api/stt": async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 300));
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "Delayed output" }) });
        },
      },
    });

    await attachAudioFile(page, "#stt-file");
    
    const transcribeBtn = page.locator("#stt-transcribe");
    await transcribeBtn.click();

    await expect(page.locator("#stt-loading")).toBeVisible();
    
    await expect(page.locator("#stt-result")).toBeVisible();
    await expect(page.locator("#stt-loading")).toBeHidden();
    await expect(page.locator("#stt-text")).toHaveValue("Delayed output");
  });

  test("error: shows error message on API failure", async ({ page }) => {
    await installApiMocks(page, {
      handlers: {
        "POST /api/stt": async (route) => {
          await route.fulfill({ status: 500, contentType: "application/json", body: "invalid json" });
        },
      },
    });

    await attachAudioFile(page, "#stt-file");
    await page.locator("#stt-transcribe").click();

    await expect(page.locator("#stt-result")).toBeVisible();
    await expect(page.locator("#stt-text")).toHaveValue(/Error:/);
  });

  test("edge: sends correct form data options", async ({ page }) => {
    let requestBody = "";

    await installApiMocks(page, {
      handlers: {
        "POST /api/stt": async (route) => {
          const req = route.request();
          requestBody = req.postDataBuffer()?.toString() || "";
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "Edge output" }) });
        },
      },
    });

    await attachAudioFile(page, "#stt-file");
    
    await page.locator("#stt-language").selectOption("es");
    await page.locator("#stt-translate").check();
    await page.locator("#stt-transliterate").check();

    await page.locator("#stt-transcribe").click();

    await expect(page.locator("#stt-result")).toBeVisible();

    expect(requestBody).toContain('name="language"');
    expect(requestBody).toContain("es");
    expect(requestBody).toContain('name="translate"');
    expect(requestBody).toContain("true");
    expect(requestBody).toContain('name="transliterate"');
    expect(requestBody).toContain("true");
  });

  test("keyboard: focus transcribe button and press Enter", async ({ page }) => {
    await attachAudioFile(page, "#stt-file");
    
    await expect(page.locator("#stt-file-info")).toBeVisible();
    await expect(page.locator("#stt-transcribe")).toBeEnabled();

    await page.locator("#stt-transcribe").focus();
    await page.keyboard.press("Enter");

    await expect(page.locator("#stt-result")).toBeVisible();
    await expect(page.locator("#stt-text")).toHaveValue("Mock transcription output");
  });
});
