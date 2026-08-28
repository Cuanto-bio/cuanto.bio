import { expect, type Page } from '@playwright/test';
import type { Sql } from 'postgres';
import type { GpsTrackPoint } from '../../src/lib/gpx';
import { CUANTO_IDB_VERSION } from '../../src/lib/offline/constants';
import type { PendingSurvey } from '../../src/lib/offline/db';

// Writes a device-local GPS track straight into IndexedDB, as recording a
// survey would. The page must already have visited the app so the DB exists.
export async function seedLocalTrack(
  page: Page,
  surveyAtUri: string,
  points: GpsTrackPoint[],
) {
  await page.evaluate(
    ({ surveyAtUri, points, version }) => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('cuanto', version);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('gps-tracks', 'readwrite');
          tx.objectStore('gps-tracks').put({ atUri: surveyAtUri, points });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    },
    { surveyAtUri, points, version: CUANTO_IDB_VERSION },
  );
}

// Adds `count` extra verbatim targets to an already-seeded protocol so the
// target list is long enough to scroll. Must run before the survey page caches
// the protocol to IndexedDB.
export async function seedExtraTargets(
  sql: Sql,
  did: string,
  protocolRkey: string,
  count: number,
) {
  const protocolUri = `at://${did}/bio.cuanto.surveyProtocol/${protocolRkey}`;
  for (let i = 0; i < count; i++) {
    const rkey = `xtarget${i}-${Date.now()}`;
    const atUri = `at://${did}/bio.cuanto.protocolTarget/${rkey}`;
    const record = {
      $type: 'bio.cuanto.protocolTarget',
      protocol: protocolUri,
      scope: [
        {
          $type: 'bio.cuanto.protocolTarget#verbatimScope',
          verbatimTargetScope: `Filler target ${i}`,
        },
      ],
    };
    await sql`
      INSERT INTO protocol_targets (at_uri, did, rkey, protocol_uri, record, indexed_at)
      VALUES (${atUri}, ${did}, ${rkey}, ${protocolUri}, ${sql.json(record)},
        ${new Date(Date.now() + 10_000 + i * 1_000).toISOString()})
    `;
  }
}

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

// Reads every pending-survey row straight out of IndexedDB. Assertions about
// whether a survey is still "in progress" have to look here rather than at the
// page: /app/surveys reads IDB once on mount, so a write that lands afterwards
// never shows up in the DOM.
export async function readPendingSurveys(page: Page): Promise<PendingSurvey[]> {
  return page.evaluate(
    () =>
      new Promise<PendingSurvey[]>((resolve, reject) => {
        const req = indexedDB.open('cuanto');
        req.onsuccess = () => {
          const tx = req.result.transaction('pending-surveys', 'readonly');
          const getAll = tx.objectStore('pending-surveys').getAll();
          getAll.onsuccess = () => resolve(getAll.result);
          getAll.onerror = () => reject(getAll.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
}
