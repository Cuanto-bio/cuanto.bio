import {
  expect,
  seedProtocolWithLocationOptions,
  seedProtocolWithManyLocationOptions,
  teardownDid,
  test,
} from '../fixtures.js';
import { cacheAndOpenNewSurvey, confirmFinishSurvey } from './helpers.js';

// ── Survey page with locationOptions ─────────────────────────────────────────

const LOC_SURVEY_DID = 'did:test:survey-loc-spec';
const LOC_SURVEY_HANDLE = 'user-survey-loc-spec';

test.describe('survey with locationOptions', () => {
  let locProtocolRkey: string;

  test.beforeEach(async ({ sql, context }) => {
    await sql`
      INSERT INTO users (did, handle) VALUES (${LOC_SURVEY_DID}, ${LOC_SURVEY_HANDLE})
      ON CONFLICT (did) DO UPDATE SET handle = EXCLUDED.handle
    `;
    await context.addCookies([
      {
        name: 'did',
        value: LOC_SURVEY_DID,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    ({ protocolRkey: locProtocolRkey } = await seedProtocolWithLocationOptions(
      sql,
      LOC_SURVEY_DID,
    ));
  });

  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, LOC_SURVEY_DID);
  });

  test('GPS button is not shown when protocol has location options', async ({
    page,
  }) => {
    await cacheAndOpenNewSurvey(page, LOC_SURVEY_HANDLE, locProtocolRkey);

    await expect(
      page.getByRole('button', { name: /add gps location/i }),
    ).not.toBeVisible();
  });

  test('shows radio buttons instead of free-text location input', async ({
    page,
  }) => {
    await cacheAndOpenNewSurvey(page, LOC_SURVEY_HANDLE, locProtocolRkey);

    await expect(
      page.locator('input[name="locationOption"]').first(),
    ).toBeVisible();
    await expect(
      page.locator('[placeholder="e.g. Mission Dolores Park"]'),
    ).not.toBeVisible();
  });

  test('finish survey is blocked without selecting a location', async ({
    page,
  }) => {
    await cacheAndOpenNewSurvey(page, LOC_SURVEY_HANDLE, locProtocolRkey);

    await confirmFinishSurvey(page);

    await expect(page.getByText('Location name is required')).toBeVisible();
  });

  test('selecting a radio with geo saves the location name and coordinates', async ({
    page,
    sql,
  }) => {
    await cacheAndOpenNewSurvey(page, LOC_SURVEY_HANDLE, locProtocolRkey);

    await page.getByRole('radio', { name: 'China Camp' }).click();
    await confirmFinishSurvey(page);

    await expect(page).toHaveURL(
      new RegExp(`/app/surveys/${LOC_SURVEY_HANDLE}/\\w+`),
    );

    const [row] = await sql<{ record: Record<string, unknown> }[]>`
      SELECT record FROM surveys WHERE did = ${LOC_SURVEY_DID}
      ORDER BY indexed_at DESC LIMIT 1
    `;

    const location = row.record.location as {
      name: string;
      locations?: { latitude: string; longitude: string }[];
    };
    expect(location.name).toBe('China Camp');
    expect(location.locations).toHaveLength(1);
    expect(location.locations![0].latitude).toBe('38.004');
    expect(location.locations![0].longitude).toBe('-122.4978');
  });

  test('switching from a geo option to a name-only option clears coordinates', async ({
    page,
    sql,
  }) => {
    await cacheAndOpenNewSurvey(page, LOC_SURVEY_HANDLE, locProtocolRkey);

    // First pick the geo-tagged option, then switch to the name-only option.
    await page.getByRole('radio', { name: 'China Camp' }).click();
    await page.getByRole('radio', { name: 'Mission Creek' }).click();
    await confirmFinishSurvey(page);

    await expect(page).toHaveURL(
      new RegExp(`/app/surveys/${LOC_SURVEY_HANDLE}/\\w+`),
    );

    const [row] = await sql<{ record: Record<string, unknown> }[]>`
      SELECT record FROM surveys WHERE did = ${LOC_SURVEY_DID}
      ORDER BY indexed_at DESC LIMIT 1
    `;

    const location = row.record.location as {
      name: string;
      locations?: unknown[];
      latitude?: string;
      longitude?: string;
    };
    expect(location.name).toBe('Mission Creek');
    // No coordinates should be attached when the selected option has no geo.
    expect(location.locations).toBeUndefined();
    expect(location.latitude).toBeUndefined();
    expect(location.longitude).toBeUndefined();
  });
});

// ── Survey page with many locationOptions (combobox) ─────────────────────────

const COMBOBOX_DID = 'did:test:survey-combobox-spec';
const COMBOBOX_HANDLE = 'user-survey-combobox-spec';

test.describe('survey with many locationOptions (combobox)', () => {
  let comboboxProtocolRkey: string;

  test.beforeEach(async ({ sql, context }) => {
    await sql`
      INSERT INTO users (did, handle) VALUES (${COMBOBOX_DID}, ${COMBOBOX_HANDLE})
      ON CONFLICT (did) DO UPDATE SET handle = EXCLUDED.handle
    `;
    await context.addCookies([
      {
        name: 'did',
        value: COMBOBOX_DID,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    ({ protocolRkey: comboboxProtocolRkey } =
      await seedProtocolWithManyLocationOptions(sql, COMBOBOX_DID));
  });

  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, COMBOBOX_DID);
  });

  test('shows combobox instead of radio buttons when there are more than 5 options', async ({
    page,
  }) => {
    await cacheAndOpenNewSurvey(page, COMBOBOX_HANDLE, comboboxProtocolRkey);

    await expect(
      page.getByRole('button', { name: /Select a location/ }),
    ).toBeVisible();
    await expect(
      page.locator('input[name="locationOption"]'),
    ).not.toBeVisible();
  });

  test('can select a location from the combobox and submit the survey', async ({
    page,
    sql,
  }) => {
    await cacheAndOpenNewSurvey(page, COMBOBOX_HANDLE, comboboxProtocolRkey);

    await page.getByRole('button', { name: /Select a location/ }).click();
    await page.getByRole('option', { name: 'China Camp' }).click();
    await confirmFinishSurvey(page);

    await expect(page).toHaveURL(
      new RegExp(`/app/surveys/${COMBOBOX_HANDLE}/\\w+`),
    );

    const [row] = await sql<{ record: Record<string, unknown> }[]>`
      SELECT record FROM surveys WHERE did = ${COMBOBOX_DID}
      ORDER BY indexed_at DESC LIMIT 1
    `;

    const location = row.record.location as {
      name: string;
      locations?: { latitude: string; longitude: string }[];
    };
    expect(location.name).toBe('China Camp');
    expect(location.locations).toHaveLength(1);
    expect(location.locations![0].latitude).toBe('38.004');
  });
});
