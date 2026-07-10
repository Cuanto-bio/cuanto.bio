import { expect, type Page } from '@playwright/test';

export async function cacheAndOpenNewSurvey(
  page: Page,
  handle: string,
  protocolRkey: string,
) {
  // Visit the /app/ protocol page so it caches the protocol to IndexedDB.
  await page.goto(`/app/protocols/${handle}/${protocolRkey}`);
  await page.waitForLoadState('networkidle');
  await page.goto(`/app/surveys/new/${protocolRkey}`);
  // Wait for the protocol to load from IDB and the form to render.
  await page.waitForSelector('text=Finish Survey', { state: 'visible' });
}

// Opens the finish confirmation dialog and clicks Finish to submit.
export async function confirmFinishSurvey(page: Page) {
  await page.getByRole('button', { name: 'Finish Survey' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
}

// Replaces watchPosition with a hook the test drives, so track recording is
// deterministic and needs no real waits. Must run before the first navigation.
export async function mockWatchPosition(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        watchPosition: (success: PositionCallback) => {
          (window as unknown as Record<string, unknown>).__geoPush = (
            lat: number,
            lng: number,
            accuracy: number,
            timestamp: number,
          ) =>
            success({
              coords: { latitude: lat, longitude: lng, accuracy },
              timestamp,
            } as GeolocationPosition);
          return 1;
        },
        clearWatch: () => {},
      },
      configurable: true,
    });
  });
}

// Pushes a fix sequence with controlled timestamps. With the production warm-up
// params, the warm-up window converges once accuracy is stable for the seed plus
// three fixes, committing the first point; a fix past the 10s steady window then
// commits a second via best-of-window.
export async function pushTrackFixes(page: Page) {
  await page.evaluate(() => {
    const push = (window as unknown as Record<string, unknown>).__geoPush as (
      lat: number,
      lng: number,
      accuracy: number,
      timestamp: number,
    ) => void;
    const t = Date.now();
    push(37.0, -122.0, 5, t);
    push(37.0, -122.0, 5, t + 1_000);
    push(37.0, -122.0, 5, t + 2_000);
    push(37.0, -122.0, 5, t + 3_000); // warm-up converges -> point 1
    push(37.1, -122.1, 5, t + 14_000); // closes steady window -> point 2
  });
}

// Waits until the live recorder has committed at least one point.
export async function waitForRecordedPoint(page: Page) {
  await expect
    .poll(async () => {
      const text = await page
        .getByText('Recording:', { exact: false })
        .textContent();
      return Number(text?.match(/\d+/)?.[0] ?? 0);
    })
    .toBeGreaterThan(0);
}
