import { test, expect } from "@playwright/test";

test.describe("TTS Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.click('[data-tab="tts"]');
  });

  test("Piper TTS generates audio", async ({ page }) => {
    await page.fill("#tts-text", "Hello, this is a test.");
    // Piper is selected by default
    await page.click("#tts-generate");
    // Wait for audio result to appear
    await expect(page.locator("#tts-result")).toBeVisible({ timeout: 15000 });
    // Wait for the download link href to be set (blob: URL)
    await expect(page.locator("#tts-download")).toHaveAttribute("href", /blob:/, { timeout: 5000 });
  });

  test("Parler TTS shows service unavailable error inline", async ({ page }) => {
    // Check if Parler radio is disabled (service not running)
    const parlerRadio = page.locator('input[name="tts-engine"][value="parler"]');
    const isDisabled = await parlerRadio.isDisabled();

    if (isDisabled) {
      // Parler is already disabled by health check — verify the label tooltip
      const label = page.locator('label.engine-unavailable');
      await expect(label).toBeVisible();
      const title = await label.getAttribute("title");
      expect(title).toContain("not running");
    } else {
      // Parler radio is enabled — select it and try to generate
      await parlerRadio.check({ force: true });
      await page.fill("#tts-text", "Test parler");
      await page.click("#tts-generate");
      // Should show inline error, not an alert
      await expect(page.locator("#tts-error")).toBeVisible({ timeout: 15000 });
      const errorText = await page.locator("#tts-error").textContent();
      expect(errorText).toContain("not running");
    }
  });

  test("TTS errors display inline, not via alert", async ({ page }) => {
    // Listen for dialogs (alerts) — none should fire
    let alertFired = false;
    page.on("dialog", () => { alertFired = true; });

    // Force a request to Parler if possible
    await page.fill("#tts-text", "Alert test");
    const parlerRadio = page.locator('input[name="tts-engine"][value="parler"]');
    if (!(await parlerRadio.isDisabled())) {
      await parlerRadio.check({ force: true });
      await page.click("#tts-generate");
      await page.waitForTimeout(3000);
      expect(alertFired).toBe(false);
    }
  });
});

test.describe("Health Dots", () => {
  test("Piper shows healthy, Parler shows error", async ({ page }) => {
    await page.goto("/");
    // Wait for health check to complete
    await page.waitForTimeout(2000);

    const piperDot = page.locator('.health-dot[data-service="piper"]');
    const parlerDot = page.locator('.health-dot[data-service="parler"]');

    await expect(piperDot).toHaveClass(/healthy/);
    await expect(parlerDot).toHaveClass(/error/);
  });

  test("Parler radio button disabled when service is down", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);
    await page.click('[data-tab="tts"]');

    const parlerRadio = page.locator('input[name="tts-engine"][value="parler"]');
    await expect(parlerRadio).toBeDisabled();
  });
});
