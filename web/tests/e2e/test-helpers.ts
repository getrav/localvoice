import { expect, type Locator, type Page, type Route } from "@playwright/test";

type RouteHandler = (route: Route, url: URL) => Promise<void> | void;

type ApiOverrides = {
  handlers?: Record<string, RouteHandler>;
};

export type SyncStatus = "pending" | "downloaded" | "transcribed" | "error";
export const CANONICAL_SYNC_STATUSES: SyncStatus[] = ["pending", "downloaded", "transcribed", "error"];

export type SyncAction = "download" | "transcribe" | "retranscribe" | "retransliterate";
export const CANONICAL_SYNC_ACTIONS: SyncAction[] = ["download", "transcribe", "retranscribe", "retransliterate"];

const baseRecordings = Array.from({ length: 30 }, (_, index) => ({
  Id: 1000 + index,
  StartTime: `2026-03-01T12:${String(index % 60).padStart(2, "0")}:00.000Z`,
  EndTime: `2026-03-01T12:${String(index % 60).padStart(2, "0")}:30.000Z`,
  FromDisplayName: `Caller ${index + 1}`,
  ToDisplayName: `Agent ${index + 1}`,
  CallType: index % 2 === 0 ? "Inbound" : "Outbound",
  Transcription: `Transcript ${index + 1}`,
}));

const syncRecords = [
  // Ensure at least one of each canonical status
  ...CANONICAL_SYNC_STATUSES.map((sync_status, index) => ({
    id: 2000 + index,
    start_time: `2026-03-01T15:${String(index).padStart(2, "0")}:00.000Z`,
    duration: 45 + index,
    from_display_name: `From ${index + 1}`,
    to_display_name: `To ${index + 1}`,
    call_type: index % 2 ? "Inbound" : "Outbound",
    sync_status,
    error_message: sync_status === "error" ? "Upstream processing error" : null,
  })),
  // Then fill the rest with random statuses as before
  ...Array.from({ length: 35 - CANONICAL_SYNC_STATUSES.length }, (_, index) => {
    const statuses = CANONICAL_SYNC_STATUSES;
    const sync_status = statuses[index % statuses.length];
    return {
      id: 2000 + CANONICAL_SYNC_STATUSES.length + index, // Adjust ID to avoid collision
      start_time: `2026-03-01T15:${String(CANONICAL_SYNC_STATUSES.length + index).padStart(2, "0")}:00.000Z`,
      duration: 45 + CANONICAL_SYNC_STATUSES.length + index,
      from_display_name: `From ${CANONICAL_SYNC_STATUSES.length + index + 1}`,
      to_display_name: `To ${CANONICAL_SYNC_STATUSES.length + index + 1}`,
      call_type: index % 2 ? "Inbound" : "Outbound",
      sync_status,
      error_message: sync_status === "error" ? "Upstream processing error" : null,
    };
  }),
];

const wavBuffer = Buffer.from(
  "524946462400000057415645666d74201000000001000100401f0000803e0000020010006461746100000000",
  "hex",
);

export async function installApiMocks(page: Page, overrides: ApiOverrides = {}): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;

    const override = overrides.handlers?.[`${route.request().method()} ${pathname}`] ?? overrides.handlers?.[pathname];
    if (override) {
      await override(route, url);
      return;
    }

    if (pathname === "/api/health") {
      await json(route, [
        { name: "3cx", status: "healthy" },
        { name: "whisper", status: "healthy" },
        { name: "piper", status: "healthy" },
        { name: "kokoro", status: "healthy" },
        { name: "diarization", status: "healthy" },
      ]);
      return;
    }

    if (pathname === "/api/models") {
      await json(route, {
        active: [{ model: "Systran/faster-whisper-large-v3", backend: "faster-whisper" }],
        models: [
          { id: "Systran/faster-whisper-large-v3", name: "Large v3", size: "2.9GB", parameters: "1550M", description: "Latest large model", englishOnly: false },
          { id: "Systran/faster-whisper-small.en", name: "Small (English)", size: "466MB", parameters: "244M", description: "English-only, optimized for English transcription", englishOnly: true },
        ],
      });
      return;
    }

    if (pathname === "/api/models/current") {
      await json(route, { model: "Systran/faster-whisper-large-v3", status: "healthy" });
      return;
    }

    if (pathname === "/api/tts/voices") {
      await json(route, [
        { id: "af_heart", name: "Heart (Female)", group: "AF" },
        { id: "am_puck", name: "Puck (Male)", group: "AM" },
      ]);
      return;
    }

    if (pathname === "/api/recordings") {
      const top = Number(url.searchParams.get("top") ?? "25");
      const skip = Number(url.searchParams.get("skip") ?? "0");
      await json(route, { value: baseRecordings.slice(skip, skip + top) });
      return;
    }

    if (pathname.match(/^\/api\/recordings\/\d+\/audio$/)) {
      await route.fulfill({ status: 200, contentType: "audio/wav", body: wavBuffer });
      return;
    }

    if (pathname.match(/^\/api\/recordings\/\d+\/detail$/)) {
      await json(route, {
        from_display_name: "Caller",
        to_display_name: "Agent",
        segments: [
          { start: 1, speaker: "Speaker 1", text: "Hello there" },
          { start: 4, speaker: "Speaker 2", text: "Thanks for calling" },
        ],
      });
      return;
    }

    if (pathname.match(/^\/api\/recordings\/\d+\/call-log$/)) {
      await json(route, { segments: [] });
      return;
    }

    if (pathname.match(/^\/api\/recordings\/\d+\/segments$/)) {
      await json(route, { success: true });
      return;
    }

    if (pathname.match(/^\/api\/recordings\/\d+\/enroll-clip$/)) {
      await json(route, { success: true });
      return;
    }

    if (pathname.match(/^\/api\/recordings\/\d+\/(download|transcribe|retranscribe|retransliterate)$/) && route.request().method() === "POST") {
      const match = pathname.match(/^\/api\/recordings\/(\d+)\/(download|transcribe|retranscribe|retransliterate)$/);
      if (match) {
        const id = Number(match[1]);
        const action = match[2];

        const record = syncRecords.find((r) => r.id === id);
        if (record) {
          if (action === "download") {
            record.sync_status = "downloaded";
            record.error_message = null;
          } else if (action === "transcribe") {
            record.sync_status = "transcribed";
            record.error_message = null;
          }
          // For retranscribe and retransliterate, we can add specific logic later if needed.
          // For now, they will just return success: true.
        }
        await json(route, { success: true, id });
        return;
      }
    }

    if (pathname === "/api/stt") {
      await json(route, { text: "Mock transcription output" });
      return;
    }

    if (pathname === "/api/tts") {
      await route.fulfill({ status: 200, contentType: "audio/wav", body: wavBuffer });
      return;
    }

    if (pathname === "/api/speakers") {
      await json(route, {
        speakers: [{ speaker_id: "speaker-1", name: "Alice", description: "Support lead", num_samples: 3 }],
      });
      return;
    }

    if (pathname === "/api/speakers/enroll") {
      await json(route, { name: "Alice", num_samples: 4 });
      return;
    }

    if (pathname.match(/^\/api\/speakers\/.+$/) && route.request().method() === "DELETE") {
      await json(route, { success: true });
      return;
    }

    if (pathname === "/api/sync/status") {
      await json(route, {
        total: syncRecords.length,
        statuses: [
          { sync_status: "transcribed", count: 8 },
          { sync_status: "downloaded", count: 9 },
          { sync_status: "pending", count: 9 },
          { sync_status: "error", count: 9 },
        ],
      });
      return;
    }

    if (pathname === "/api/sync/recordings") {
      const limit = Number(url.searchParams.get("limit") ?? "25");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const filter = url.searchParams.get("status");
      const filtered = filter ? syncRecords.filter((record) => record.sync_status === filter) : syncRecords;
      await json(route, { total: filtered.length, recordings: filtered.slice(offset, offset + limit) });
      return;
    }

    if (pathname === "/api/sync/schedule") {
      if (route.request().method() === "POST") {
        await json(route, { success: true });
      } else {
        await json(route, { interval_minutes: 5, last_sync_at: "2026-03-01T12:00:00.000Z" });
      }
      return;
    }

    if (pathname === "/api/recordings/bulk-action") {
      await json(route, { success: true, count: 3 });
      return;
    }

    await json(route, { error: `Unhandled mock route: ${pathname}` }, 404);
  });
}

export async function openTab(page: Page, tab: "recordings" | "stt" | "tts" | "speakers" | "sync" | "models"): Promise<void> {
  await loc(page, `tab-${tab}-button`, `[data-tab='${tab}']`).click();
  await expect(loc(page, `tab-${tab}-content`, `#tab-${tab}`)).toHaveClass(/active/);
}

export function loc(page: Page, testId: string, fallbackCss: string): Locator {
  return page.locator(`[data-testid='${testId}'], ${fallbackCss}`);
}

export async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

export async function attachAudioFile(page: Page, selector: string, fileName = "sample.wav"): Promise<void> {
  await page.setInputFiles(selector, {
    name: fileName,
    mimeType: "audio/wav",
    buffer: wavBuffer,
  });
}

export async function expectVisualSnapshot(page: Page, name: string, maskSelectors: string[] = []): Promise<void> {
  const mask = maskSelectors.map((selector) => page.locator(selector));
  await expect(page).toHaveScreenshot(name, {
    fullPage: true,
    animations: "disabled",
    mask,
  });
}
