import { test, expect } from "@playwright/test";
import { installApiMocks, openTab, loc } from "./test-helpers";

test.describe("Models Tab", () => {
  test("Happy: renders active models and grid", async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/");
    await openTab(page, "models");

    const activeList = page.locator("#active-models-list");
    await expect(activeList.locator(".active-model")).toHaveCount(1);
    await expect(activeList).toContainText("faster-whisper-large-v3");

    const grid = page.locator("#models-grid");
    await expect(grid.locator(".model-card")).toHaveCount(2);
    await expect(grid).toContainText("faster-whisper-large-v3");
    await expect(grid).toContainText("faster-whisper-small.en");
  });

  test("Loading: shows loading state then eventually contains a model", async ({ page }) => {
    let resolveApi: (value?: any) => void;
    const apiPromise = new Promise((resolve) => {
      resolveApi = resolve;
    });

    await installApiMocks(page, {
      handlers: {
        "/api/models": async (route) => {
          await apiPromise;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              active: [{ model: "Systran/faster-whisper-large-v3", backend: "faster-whisper" }],
              models: [
                { id: "Systran/faster-whisper-large-v3", name: "Large v3", size: "2.9GB", parameters: "1550M", description: "Latest large model", englishOnly: false },
              ],
            }),
          });
        },
      },
    });

    await page.goto("/");
    
    const activeList = page.locator("#active-models-list");
    await expect(activeList).toContainText("Loading...");

    resolveApi!();

    await openTab(page, "models");

    await expect(activeList.locator(".active-model")).toHaveCount(1);
    await expect(activeList).toContainText("faster-whisper-large-v3");
  });

  test("Error: shows error message when /api/models returns 500", async ({ page }) => {
    await installApiMocks(page, {
      handlers: {
        "/api/models": async (route) => {
          await route.fulfill({ status: 500 });
        },
      },
    });

    await page.goto("/");
    await openTab(page, "models");

    const grid = page.locator("#models-grid");
    await expect(grid).toContainText("Error loading models");
  });

  test("Edge fallback: uses /api/models/current when active array is empty", async ({ page }) => {
    await installApiMocks(page, {
      handlers: {
        "/api/models": async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ active: [], models: [] }),
          });
        },
        "/api/models/current": async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ model: "Systran/faster-whisper-large-v3", status: "healthy" }),
          });
        },
      },
    });

    await page.goto("/");
    await openTab(page, "models");

    const activeList = page.locator("#active-models-list");
    await expect(activeList.locator(".active-model")).toHaveCount(1);
    await expect(activeList).toContainText("faster-whisper-large-v3");
    await expect(activeList).toContainText("healthy");
  });

  test("Keyboard: activates Models tab via Enter", async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/");

    const modelsTabBtn = loc(page, "tab-models-button", "[data-tab='models']");
    await modelsTabBtn.focus();
    await page.keyboard.press("Enter");

    const tabContent = loc(page, "tab-models-content", "#tab-models");
    await expect(tabContent).toHaveClass(/active/);
  });
});
