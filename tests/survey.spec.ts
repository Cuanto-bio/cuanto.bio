import {
  expect,
  seedProtocol,
  seedProtocolWithLocationOptions,
  seedProtocolWithManyLocationOptions,
  seedSurvey,
  teardownDid,
  test,
} from './fixtures.js';

async function cacheAndOpenNewSurvey(
  page: import('@playwright/test').Page,
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

test('can create a survey and see it in the surveys list', async ({
  page,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

  const placeholder = '[placeholder="e.g. Mission Dolores Park"]';
  await page.fill(placeholder, 'Integration Test Park');
  await page.locator('[aria-label="Increase count"]').first().click();
  await page.locator('[aria-label="Increase count"]').first().click();
  await page.click('text=Finish Survey');

  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);
  await expect(page.getByText('Integration Test Park')).toBeVisible();
});

test('survey detail page shows occurrences', async ({ page, protocolRkey }) => {
  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

  const placeholder = '[placeholder="e.g. Mission Dolores Park"]';
  await page.fill(placeholder, 'Detail Test Site');
  await page.locator('[aria-label="Increase count"]').nth(1).click();
  await page.click('text=Finish Survey');

  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);
  await expect(page.getByText('All birds')).toBeVisible();
  await expect(page.getByText('1', { exact: true })).toBeVisible();
});

test('can create survey from protocol created by different user', async ({
  page,
  context,
  sql,
  protocolRkey,
}) => {
  // protocolRkey belongs to 'did:test:survey-spec' (set up by the fixture).
  // Switch to a different authenticated user.
  const otherDid = 'did:test:survey-spec-other-user';
  await seedProtocol(sql, otherDid);

  await context.addCookies([
    {
      name: 'did',
      value: otherDid,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

  const placeholder = '[placeholder="e.g. Mission Dolores Park"]';
  await page.fill(placeholder, 'Cross-user Survey');
  await page.locator('[aria-label="Increase count"]').first().click();
  await page.click('text=Finish Survey');

  await expect(page).toHaveURL(
    /\/app\/surveys\/user-survey-spec-other-user\/\w+/,
  );
  await expect(page.getByText('Cross-user Survey')).toBeVisible();

  await teardownDid(sql, otherDid);
});

// ── Public survey routes ───────────────────────────────────────────────────────

const PUBLIC_DID = 'did:test:survey-public';
const PUBLIC_HANDLE = 'user-survey-public';

test('/surveys shows location name from JSONB record', async ({
  page,
  sql,
}) => {
  await sql`
    INSERT INTO users (did, handle) VALUES (${PUBLIC_DID}, ${PUBLIC_HANDLE})
    ON CONFLICT (did) DO NOTHING
  `;
  const { protocolRkey } = await seedProtocol(sql, PUBLIC_DID);
  const protocolUri = `at://${PUBLIC_DID}/bio.lexicons.temp.surveyProtocol/${protocolRkey}`;
  await seedSurvey(sql, PUBLIC_DID, protocolUri, 'Public Test Meadow');

  try {
    await page.goto('/surveys');
    await expect(page.getByText('Public Test Meadow')).toBeVisible();
    await expect(page.getByText('Test Protocol')).toBeVisible();
  } finally {
    await teardownDid(sql, PUBLIC_DID);
  }
});

test('/surveys/[handle] shows surveys for that user from JSONB record', async ({
  page,
  sql,
}) => {
  await sql`
    INSERT INTO users (did, handle) VALUES (${PUBLIC_DID}, ${PUBLIC_HANDLE})
    ON CONFLICT (did) DO NOTHING
  `;
  const { protocolRkey } = await seedProtocol(sql, PUBLIC_DID);
  const protocolUri = `at://${PUBLIC_DID}/bio.lexicons.temp.surveyProtocol/${protocolRkey}`;
  await seedSurvey(sql, PUBLIC_DID, protocolUri, 'Handle Route Meadow');

  try {
    await page.goto(`/surveys/${PUBLIC_HANDLE}`);
    await expect(page.getByText('Handle Route Meadow')).toBeVisible();
    await expect(page.getByText('Test Protocol')).toBeVisible();
  } finally {
    await teardownDid(sql, PUBLIC_DID);
  }
});

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

test('clicking Add GPS location button requests geolocation', async ({
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
  await page.getByRole('button', { name: /gps/i }).click();

  const geoRequested = await page.evaluate(
    () => !!(window as unknown as Record<string, unknown>).__geoRequested,
  );
  expect(geoRequested).toBe(true);
});

// ── Target search filter ──────────────────────────────────────────────────────

test.describe('target search filter', () => {
  test('shows search field when protocol has targets', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await expect(page.getByPlaceholder('Search targets…')).toBeVisible();
  });

  test('filters taxon targets by scientificName', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.getByPlaceholder('Search targets…').fill('Quercus');
    await expect(page.getByText('Quercus agrifolia')).toBeVisible();
    await expect(page.getByText('All birds')).not.toBeVisible();
  });

  test('filters verbatim targets by verbatimTargetScope', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.getByPlaceholder('Search targets…').fill('bird');
    await expect(page.getByText('All birds')).toBeVisible();
    await expect(page.getByText('Quercus agrifolia')).not.toBeVisible();
  });

  test('clearing the filter restores all targets', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    const searchInput = page.getByPlaceholder('Search targets…');
    await searchInput.fill('Quercus');
    await expect(page.getByText('All birds')).not.toBeVisible();
    await searchInput.clear();
    await expect(page.getByText('All birds')).toBeVisible();
    await expect(page.getByText('Quercus agrifolia')).toBeVisible();
  });

  test('shows no-match message when filter matches nothing', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.getByPlaceholder('Search targets…').fill('zzznomatch');
    await expect(page.getByText(/No targets match/)).toBeVisible();
  });
});

// ── Cancel survey guard ───────────────────────────────────────────────────────

test.describe('cancel survey guard', () => {
  test('Cancel Survey button opens confirmation dialog', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.getByRole('button', { name: 'Cancel Survey' }).click();
    await expect(
      page.getByRole('heading', { name: 'Cancel survey?' }),
    ).toBeVisible();
  });

  test('Keep surveying dismisses the dialog without navigating', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.getByRole('button', { name: 'Cancel Survey' }).click();
    await page.getByRole('button', { name: 'Keep surveying' }).click();
    await expect(
      page.getByRole('heading', { name: 'Cancel survey?' }),
    ).not.toBeVisible();
    await expect(page).toHaveURL(/\/app\/surveys\/new\//);
  });

  test('confirming cancel navigates back to the protocol page', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.getByRole('button', { name: 'Cancel Survey' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel survey' })
      .click();
    await expect(page).toHaveURL(/\/app\/protocols\/user-survey-spec\//);
  });
});

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

    await expect(page.getByRole('button', { name: /gps/i })).not.toBeVisible();
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

    await page.click('text=Finish Survey');

    await expect(page.getByText('Location name is required')).toBeVisible();
  });

  test('selecting a radio with geo saves the location name and coordinates', async ({
    page,
    sql,
  }) => {
    await cacheAndOpenNewSurvey(page, LOC_SURVEY_HANDLE, locProtocolRkey);

    await page.getByRole('radio', { name: 'China Camp' }).click();
    await page.click('text=Finish Survey');

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
    await page.click('text=Finish Survey');

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
    await page.click('text=Finish Survey');

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
