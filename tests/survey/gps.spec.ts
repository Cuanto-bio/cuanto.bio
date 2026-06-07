import { CUANTO_IDB_VERSION } from '../../src/lib/offline/constants';
import {
  expect,
  seedProtocol,
  seedSurvey,
  teardownDid,
  test,
} from '../fixtures.js';
import { cacheAndOpenNewSurvey } from './helpers.js';

// ── GPS location button ───────────────────────────────────────────────────────

test('does not request geolocation automatically on load', async ({
  page,
  protocolRkey,
}) => {
  let geoRequested = false;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: () => {
          (window as unknown as Record<string, unknown>).__geoRequested = true;
        },
      },
      configurable: true,
    });
  });

  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
  geoRequested = await page.evaluate(
    () => !!(window as unknown as Record<string, unknown>).__geoRequested,
  );
  expect(geoRequested).toBe(false);
});

test('selecting single point GPS mode then clicking Get location requests geolocation', async ({
  page,
  protocolRkey,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: (success: PositionCallback) => {
          (window as unknown as Record<string, unknown>).__geoRequested = true;
          success({
            coords: { latitude: 37.77, longitude: -122.41 },
          } as GeolocationPosition);
        },
      },
      configurable: true,
    });
  });

  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
  await page.getByRole('radio', { name: /single point/i }).click();
  await page.getByRole('button', { name: /get gps location/i }).click();

  const geoRequested = await page.evaluate(
    () => !!(window as unknown as Record<string, unknown>).__geoRequested,
  );
  expect(geoRequested).toBe(true);
});

test('recording a GPS track accumulates points from watchPosition fixes', async ({
  page,
  protocolRkey,
}) => {
  // Mock watchPosition so the test can push fixes with controlled timestamps
  // and accuracy, driving the warm-up + windowing logic deterministically
  // without real waits.
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

  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

  // Selecting Track auto-starts recording.
  await page.getByRole('radio', { name: 'Track' }).click();
  const recordingIndicator = page.getByText('Recording:', { exact: false });
  await expect(recordingIndicator).toBeVisible();

  // Push a fix sequence with controlled timestamps. With the production warm-up
  // params, the warm-up window converges once accuracy is stable for the seed
  // plus three fixes, committing the first point; a fix past the 10s steady
  // window then commits a second via best-of-window.
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

  // Loosely assert accumulation so the test doesn't break if warm-up params
  // change: at least one point should have been recorded and shown.
  await expect
    .poll(async () => {
      const text = await recordingIndicator.textContent();
      return Number(text?.match(/\d+/)?.[0] ?? 0);
    })
    .toBeGreaterThan(0);

  // Stopping shows the saved-point summary.
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByText(/\d+\s+points?\s+saved/)).toBeVisible();
});

test('past survey shows the map picker, not live GPS recording', async ({
  page,
  protocolRkey,
}) => {
  await page.goto(`/app/protocols/user-survey-spec/${protocolRkey}`);
  await page.waitForLoadState('networkidle');
  await page.goto(`/app/surveys/new/${protocolRkey}?past=1`);
  await page.waitForSelector('text=Finish Survey', { state: 'visible' });

  // The live-recording controls must be gone for a past survey...
  await expect(page.getByRole('radio', { name: 'Single point' })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('button', { name: /record gps track/i }),
  ).toHaveCount(0);
  // ...replaced by the map-based picker modes.
  await expect(page.getByRole('radio', { name: 'Point' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Bounding box' })).toBeVisible();
  await expect(
    page.getByRole('radio', { name: /track \(gpx\)/i }),
  ).toBeVisible();
});

test('past survey can load a track from an uploaded GPX file', async ({
  page,
  protocolRkey,
}) => {
  await page.goto(`/app/protocols/user-survey-spec/${protocolRkey}`);
  await page.waitForLoadState('networkidle');
  await page.goto(`/app/surveys/new/${protocolRkey}?past=1`);
  await page.waitForSelector('text=Finish Survey', { state: 'visible' });

  await page.getByRole('radio', { name: /track \(gpx\)/i }).click();

  const gpx = `<?xml version="1.0"?>
<gpx version="1.1"><trk><trkseg>
<trkpt lat="37.0" lon="-122.0"><time>2026-05-01T10:00:00Z</time></trkpt>
<trkpt lat="37.1" lon="-122.1"><time>2026-05-01T10:01:00Z</time></trkpt>
</trkseg></trk></gpx>`;
  await page.locator('input[type="file"]').setInputFiles({
    name: 'track.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(gpx),
  });

  // Uploaded state: filename + point count shown, file chooser replaced.
  await expect(page.getByText('track.gpx')).toBeVisible();
  await expect(page.getByText('(2 points)')).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  // Clearing restores the chooser and hides the count.
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByText('track.gpx')).toHaveCount(0);
  await expect(page.getByText('(2 points)')).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
});

// ── GPS track export and publish toggle ────────────────────────────────────────

const TRACK_DID = 'did:test:survey-spec-track';
const TRACK_HANDLE = 'user-survey-spec-track';

test('survey detail shows Export GPX button and downloads GPX when local track exists', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: TRACK_DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const { protocolRkey } = await seedProtocol(sql, TRACK_DID);
  const protocolUri = `at://${TRACK_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
  const { surveyRkey } = await seedSurvey(
    sql,
    TRACK_DID,
    protocolUri,
    'Track Test Park',
  );
  const surveyAtUri = `at://${TRACK_DID}/bio.cuanto.survey/${surveyRkey}`;

  try {
    // Visit the app once so IndexedDB exists, then seed a local GPS track.
    await page.goto(`/app/protocols/${TRACK_HANDLE}/${protocolRkey}`);
    await page.waitForLoadState('networkidle');

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
      {
        surveyAtUri,
        points: [
          { lat: 37.77, lng: -122.41, timestamp: 1700000000000 },
          { lat: 37.78, lng: -122.42, timestamp: 1700000010000 },
        ],
        version: CUANTO_IDB_VERSION,
      },
    );

    await page.goto(`/app/surveys/${TRACK_HANDLE}/${surveyRkey}`);
    await page.waitForLoadState('networkidle');

    const exportButton = page.getByRole('button', { name: /export gpx/i });
    await expect(exportButton).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await exportButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`survey-${surveyRkey}.gpx`);
  } finally {
    await teardownDid(sql, TRACK_DID);
  }
});

test('survey detail does not show Export GPX button when no track is available', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: TRACK_DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const { protocolRkey } = await seedProtocol(sql, TRACK_DID);
  const protocolUri = `at://${TRACK_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
  const { surveyRkey } = await seedSurvey(
    sql,
    TRACK_DID,
    protocolUri,
    'No Track Park',
  );

  try {
    await page.goto(`/app/protocols/${TRACK_HANDLE}/${protocolRkey}`);
    await page.waitForLoadState('networkidle');
    await page.goto(`/app/surveys/${TRACK_HANDLE}/${surveyRkey}`);
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('button', { name: /export gpx/i }),
    ).not.toBeVisible();
  } finally {
    await teardownDid(sql, TRACK_DID);
  }
});

test('pending surveys list shows publish point/bbox/track checkboxes and toggling persists', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: TRACK_DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const { protocolRkey } = await seedProtocol(sql, TRACK_DID);
  const protocolUri = `at://${TRACK_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;

  try {
    // Block uploadAllPending so the seeded survey stays in the list (its
    // navigator.onLine check would otherwise fire the upload on mount).
    await page.route('**/api/surveys', (route) => route.abort());

    await page.goto('/app/surveys');
    await page.waitForLoadState('networkidle');

    await page.evaluate(
      ({ protocolUri, protocolRkey, version }) => {
        return new Promise<void>((resolve, reject) => {
          const req = indexedDB.open('cuanto', version);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('pending-surveys', 'readwrite');
            tx.objectStore('pending-surveys').add({
              protocolUri,
              protocolRkey,
              protocolTitle: 'Test Protocol',
              locationName: 'Publish Toggle Park',
              latitude: '37.77',
              longitude: '-122.41',
              eventDate: new Date().toISOString(),
              eventDurationValue: 5,
              eventDurationUnit: 'minutes',
              occurrences: [],
              incidentals: [],
              gpsBbox: {
                north: '37.78',
                south: '37.76',
                east: '-122.40',
                west: '-122.42',
              },
              gpsTrack: [
                { lat: 37.77, lng: -122.41, timestamp: 1700000000000 },
                { lat: 37.78, lng: -122.42, timestamp: 1700000010000 },
              ],
              publishPoint: true,
              publishBbox: true,
              publishTrack: false,
              createdAt: Date.now(),
              complete: true,
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          };
          req.onerror = () => reject(req.error);
        });
      },
      { protocolUri, protocolRkey, version: CUANTO_IDB_VERSION },
    );

    await page.goto('/app/surveys');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Publish Toggle Park')).toBeVisible();

    const pointCheckbox = page.getByRole('checkbox', { name: 'Publish point' });
    const bboxCheckbox = page.getByRole('checkbox', {
      name: 'Publish bounding box',
    });
    const trackCheckbox = page.getByRole('checkbox', {
      name: 'Publish GPS track',
    });

    await expect(pointCheckbox).toBeVisible();
    await expect(bboxCheckbox).toBeVisible();
    await expect(trackCheckbox).toBeVisible();

    await expect(pointCheckbox).toBeChecked();
    await expect(bboxCheckbox).toBeChecked();
    await expect(trackCheckbox).not.toBeChecked();

    // Toggle the bbox checkbox off and verify it persisted to IDB.
    await bboxCheckbox.click();
    await expect(bboxCheckbox).not.toBeChecked();

    const stored = await page.evaluate(
      ({ version }) => {
        return new Promise<{
          publishPoint: boolean;
          publishBbox: boolean;
          publishTrack: boolean;
        } | null>((resolve, reject) => {
          const req = indexedDB.open('cuanto', version);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('pending-surveys', 'readonly');
            const all = tx.objectStore('pending-surveys').getAll();
            all.onsuccess = () => {
              const row = (
                all.result as {
                  publishPoint: boolean;
                  publishBbox: boolean;
                  publishTrack: boolean;
                }[]
              )[0];
              resolve(row ?? null);
            };
            all.onerror = () => reject(all.error);
          };
          req.onerror = () => reject(req.error);
        });
      },
      { version: CUANTO_IDB_VERSION },
    );

    expect(stored).not.toBeNull();
    expect(stored?.publishPoint).toBe(true);
    expect(stored?.publishBbox).toBe(false);
    expect(stored?.publishTrack).toBe(false);
  } finally {
    await teardownDid(sql, TRACK_DID);
  }
});
