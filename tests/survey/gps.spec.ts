import type { Page } from '@playwright/test';
import { CUANTO_IDB_VERSION } from '../../src/lib/offline/constants';
import {
  expect,
  seedProtocol,
  seedSurvey,
  teardownDid,
  test,
} from '../fixtures.js';
import {
  cacheAndOpenNewSurvey,
  mockWatchPosition,
  pushTrackFixes,
  seedLocalTrack,
  waitForRecordedPoint,
} from './helpers.js';

function watchCount(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __watchCount?: number }).__watchCount ?? 0,
  );
}

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
  await mockWatchPosition(page);

  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

  // Selecting Track auto-starts recording.
  await page.getByRole('radio', { name: 'Track' }).click();
  await expect(page.getByText('Recording:', { exact: false })).toBeVisible();

  await pushTrackFixes(page);

  // Loosely assert accumulation so the test doesn't break if warm-up params
  // change: at least one point should have been recorded and shown.
  await waitForRecordedPoint(page);

  // Stopping shows the saved-point summary.
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByText(/\d+\s+points?\s+saved/)).toBeVisible();
});

// ── Resuming a survey in progress (#30) ──────────────────────────────────────

test('resuming a survey restarts a track that was recording when navigating away', async ({
  page,
  protocolRkey,
}) => {
  await mockWatchPosition(page);
  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

  // Selecting Track auto-starts recording.
  await page.getByRole('radio', { name: 'Track' }).click();
  await expect(page.getByText('Recording:', { exact: false })).toBeVisible();

  // Navigate away; beforeNavigate auto-saves the draft.
  await page.getByRole('link', { name: 'Your Surveys' }).click();
  await page.waitForURL(/\/app\/surveys$/);

  await page.getByRole('link', { name: 'Resume', exact: true }).click();
  await page.waitForSelector('text=Finish Survey', { state: 'visible' });

  await expect(page.getByText('Recording:', { exact: false })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Stop recording' }),
  ).toBeVisible();
});

test('resuming a survey does not restart a track that was stopped', async ({
  page,
  protocolRkey,
}) => {
  await mockWatchPosition(page);
  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

  await page.getByRole('radio', { name: 'Track' }).click();
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(
    page.getByRole('button', { name: 'Record GPS track' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Your Surveys' }).click();
  await page.waitForURL(/\/app\/surveys$/);

  const beforeResume = await watchCount(page);

  await page.getByRole('link', { name: 'Resume', exact: true }).click();
  await page.waitForSelector('text=Finish Survey', { state: 'visible' });

  await expect(
    page.getByRole('button', { name: 'Record GPS track' }),
  ).toBeVisible();
  await expect(page.getByText('Recording:', { exact: false })).toHaveCount(0);
  expect(await watchCount(page)).toBe(beforeResume);
});

test('editing an un-uploaded survey does not start GPS track recording', async ({
  page,
  protocolRkey,
}) => {
  await mockWatchPosition(page);
  // Cache the protocol so the resumed form can render offline.
  await page.goto(`/app/protocols/user-survey-spec/${protocolRkey}`);
  await page.waitForLoadState('networkidle');

  // A finished-but-un-uploaded survey whose track was still recording when it
  // was saved must not resume recording when opened for editing.
  const resumeId = await page.evaluate(
    ({ protocolRkey, version }) => {
      return new Promise<number>((resolve, reject) => {
        const req = indexedDB.open('cuanto', version);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('pending-surveys', 'readwrite');
          const add = tx.objectStore('pending-surveys').add({
            surveyRkey: 'testtrackrkey',
            protocolUri: `at://did:test:survey-spec/bio.cuanto.surveyProtocol/${protocolRkey}`,
            protocolRkey,
            protocolTitle: 'Test Protocol',
            locationName: 'Un-uploaded Park',
            latitude: '37.77',
            longitude: '-122.41',
            eventDate: new Date().toISOString(),
            eventDurationValue: 5,
            eventDurationUnit: 'minutes',
            occurrences: [],
            incidentals: [],
            gpsTrack: [{ lat: 37.77, lng: -122.41, timestamp: 1700000000000 }],
            gpsMode: 'track',
            trackSource: 'device',
            trackRecording: true,
            publishPoint: true,
            publishBbox: true,
            publishTrack: false,
            createdAt: Date.now(),
            complete: true,
          });
          // Resolve on commit, not on add.onsuccess: navigating away before the
          // transaction commits would abort the write.
          tx.oncomplete = () => resolve(add.result as number);
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    },
    { protocolRkey, version: CUANTO_IDB_VERSION },
  );

  await page.goto(`/app/surveys/new/${protocolRkey}?resumeId=${resumeId}`);
  await page.waitForSelector('text=Finish Survey', { state: 'visible' });

  expect(await watchCount(page)).toBe(0);
  await expect(page.getByText('Recording:', { exact: false })).toHaveCount(0);
});

test('recording a GPS track reports distance traveled in the chosen unit', async ({
  page,
  protocolRkey,
}) => {
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
  await page.getByRole('radio', { name: 'Track' }).click();
  await expect(page.getByText('Recording:', { exact: false })).toBeVisible();

  // Warm-up converges after a stable seed plus three fixes, then each fix past a
  // 10s steady window commits another point. Two committed points a tenth of a
  // degree apart give a distance well clear of zero.
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
    push(37.0, -122.0, 5, t + 3_000);
    push(37.1, -122.0, 5, t + 14_000);
    push(37.2, -122.0, 5, t + 25_000);
  });

  // Distance shows only once there are at least two points to measure between.
  const kmReadout = page.getByText(/^[\d,.]+ km$/);
  await expect(kmReadout).toBeVisible();
  const kmText = (await kmReadout.textContent()) ?? '';
  const km = Number(kmText.replace(/[^\d.]/g, ''));
  expect(km).toBeGreaterThan(0);

  // Switching units reruns the conversion against the same underlying metres.
  const unitPicker = page.getByRole('button', { name: 'Distance units' });
  await expect(unitPicker).toHaveText('km');
  await unitPicker.click();
  await page.getByRole('option', { name: 'miles' }).click();
  await expect(unitPicker).toHaveText('mi');

  const miText = (await page.getByText(/^[\d,.]+ mi$/).textContent()) ?? '';
  const mi = Number(miText.replace(/[^\d.]/g, ''));
  expect(mi).toBeCloseTo(km / 1.609344, 1);
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

    await seedLocalTrack(page, surveyAtUri, [
      { lat: 37.77, lng: -122.41, timestamp: 1700000000000 },
      { lat: 37.78, lng: -122.42, timestamp: 1700000010000 },
    ]);

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

test('survey detail reports the distance traveled along a local track', async ({
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
    await page.goto(`/app/protocols/${TRACK_HANDLE}/${protocolRkey}`);
    await page.waitForLoadState('networkidle');

    // Two fixes 0.01° apart in each axis near 37.8°N: ~1.42 km.
    await seedLocalTrack(page, surveyAtUri, [
      { lat: 37.77, lng: -122.41, timestamp: 1700000000000 },
      { lat: 37.78, lng: -122.42, timestamp: 1700000010000 },
    ]);

    await page.goto(`/app/surveys/${TRACK_HANDLE}/${surveyRkey}`);
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('rowheader', { name: 'Distance' }),
    ).toBeVisible();
    await expect(page.getByText('1.42 km', { exact: true })).toBeVisible();

    // The unit picker converts the same track to miles.
    const unitPicker = page.getByRole('button', { name: 'Distance units' });
    await unitPicker.click();
    await page.getByRole('option', { name: 'miles' }).click();
    await expect(page.getByText('0.88 mi', { exact: true })).toBeVisible();
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
