import {
  expect,
  seedProtocol,
  seedProtocolWithLocationOptions,
  seedProtocolWithManyLocationOptions,
  seedSurvey,
  seedSurveyWithCoordinates,
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

// Opens the finish confirmation dialog and clicks Finish to submit.
async function confirmFinishSurvey(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Finish Survey' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
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
  await confirmFinishSurvey(page);

  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);
  await expect(page.getByText('Integration Test Park')).toBeVisible();
});

test('survey detail page shows occurrences', async ({ page, protocolRkey }) => {
  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

  const placeholder = '[placeholder="e.g. Mission Dolores Park"]';
  await page.fill(placeholder, 'Detail Test Site');
  await page.locator('[aria-label="Increase count"]').nth(1).click();
  await confirmFinishSurvey(page);

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
  await confirmFinishSurvey(page);

  await expect(page).toHaveURL(
    /\/app\/surveys\/user-survey-spec-other-user\/\w+/,
  );
  await expect(page.getByText('Cross-user Survey')).toBeVisible();

  await teardownDid(sql, otherDid);
});

// ── surveyorCount validation ──────────────────────────────────────────────────

test.describe('surveyorCount validation', () => {
  test('shows error immediately when input is invalid', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    for (const value of ['-1', '1.5', '0', 'abc']) {
      await page.fill('#surveyorCount', value);
      await expect(
        page.getByText('Number of surveyors must be a positive integer'),
      ).toBeVisible();
      await page.fill('#surveyorCount', '');
      await expect(
        page.getByText('Number of surveyors must be a positive integer'),
      ).not.toBeVisible();
    }
  });

  test('saves surveyorCount to the survey record when valid', async ({
    page,
    protocolRkey,
    sql,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.fill('[placeholder="e.g. Mission Dolores Park"]', 'Test Site');
    await page.fill('#surveyorCount', '3');
    await confirmFinishSurvey(page);
    await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);
    const [row] = await sql<{ record: Record<string, unknown> }[]>`
      SELECT record FROM surveys WHERE did = 'did:test:survey-spec'
      ORDER BY indexed_at DESC LIMIT 1
    `;
    expect(row.record.surveyorCount).toBe(3);
  });
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
  const protocolUri = `at://${PUBLIC_DID}/bio.lexicons.temp.v0-1.surveyProtocol/${protocolRkey}`;
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
  const protocolUri = `at://${PUBLIC_DID}/bio.lexicons.temp.v0-1.surveyProtocol/${protocolRkey}`;
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
    await expect(
      page.getByText('Coast live oak (Quercus agrifolia)'),
    ).toBeVisible();
    await expect(page.getByText('All birds')).not.toBeVisible();
  });

  test('filters taxon targets by vernacularName', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.getByPlaceholder('Search targets…').fill('coast');
    await expect(
      page.getByText('Coast live oak (Quercus agrifolia)'),
    ).toBeVisible();
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

  test('survey form shows vernacularName as primary label', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await expect(
      page.getByText('Coast live oak (Quercus agrifolia)'),
    ).toBeVisible();
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

// ── Target sort and filter dropdown ───────────────────────────────────────────

test.describe('target sort and filter dropdown', () => {
  // The fixture seeds two targets in this order:
  //   [0] taxon: Quercus agrifolia / Coast live oak
  //   [1] verbatim: All birds
  // Both scientific and common sorts should put "All birds" first (A < C and A < Q).

  async function openDropdown(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Sort and filter' }).click();
  }

  const targetList = (page: import('@playwright/test').Page) =>
    page
      .locator('ul')
      .filter({ has: page.locator('[aria-label="Increase count"]') });

  test('sorting by scientific name reorders targets', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await openDropdown(page);
    await page.getByRole('menuitemradio', { name: 'Scientific name' }).click();
    await expect(targetList(page).locator('li').first()).toContainText(
      'All birds',
    );
  });

  test('sorting by common name reorders targets', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await openDropdown(page);
    await page.getByRole('menuitemradio', { name: 'Common name' }).click();
    await expect(targetList(page).locator('li').first()).toContainText(
      'All birds',
    );
  });

  test('"Only observed" hides targets with zero count', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.locator('[aria-label="Increase count"]').nth(0).click();
    await openDropdown(page);
    await page.getByRole('menuitemcheckbox', { name: 'Only observed' }).click();
    await expect(page.getByText('Coast live oak')).toBeVisible();
    await expect(page.getByText('All birds')).not.toBeVisible();
  });

  test('"Show all targets" clears search query and observed filter', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.getByPlaceholder('Search targets…').fill('coast');
    await expect(page.getByText('All birds')).not.toBeVisible();
    await page.getByRole('button', { name: 'Show all targets' }).click();
    await expect(page.getByText('All birds')).toBeVisible();
    await expect(page.getByPlaceholder('Search targets…')).toHaveValue('');
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

// ── Finish survey confirmation dialog ────────────────────────────────────────

test.describe('finish survey confirmation dialog', () => {
  test('Finish Survey button opens a confirmation dialog', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.getByRole('button', { name: 'Finish Survey' }).click();
    await expect(
      page.getByRole('heading', { name: 'Finish survey?' }),
    ).toBeVisible();
  });

  test('Keep going dismisses the finish dialog without submitting', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.getByRole('button', { name: 'Finish Survey' }).click();
    await page.getByRole('button', { name: 'Keep going' }).click();
    await expect(
      page.getByRole('heading', { name: 'Finish survey?' }),
    ).not.toBeVisible();
    await expect(page).toHaveURL(/\/app\/surveys\/new\//);
  });

  test('dialog shows location in summary', async ({ page, protocolRkey }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.fill('[placeholder="e.g. Mission Dolores Park"]', 'Owl Ridge');
    await page.getByRole('button', { name: 'Finish Survey' }).click();
    await expect(page.getByText('Owl Ridge')).toBeVisible();
  });

  test('finish dialog requires location before completing', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await confirmFinishSurvey(page);
    await expect(page.getByText('Location name is required')).toBeVisible();
    await expect(page).toHaveURL(/\/app\/surveys\/new\//);
  });
});

// ── Protocol link removed ─────────────────────────────────────────────────────

test('survey form does not show a back link to the protocol', async ({
  page,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
  await expect(
    page.getByRole('link', { name: /← Protocol/i }),
  ).not.toBeVisible();
});

// ── Navigation guard: auto-save on navigate away ──────────────────────────────

test.describe('navigation guard', () => {
  test('navigating away from an in-progress survey saves a draft', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.fill(
      '[placeholder="e.g. Mission Dolores Park"]',
      'Nav Guard Park',
    );

    // Click the sidebar link to trigger beforeNavigate
    await page.getByRole('link', { name: 'Your Surveys' }).click();
    await page.waitForURL(/\/app\/surveys$/);

    await expect(page.getByText('In progress')).toBeVisible();
    await expect(page.getByText('Nav Guard Park')).toBeVisible();
  });

  test('draft from navigating away can be resumed with form state restored', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.fill(
      '[placeholder="e.g. Mission Dolores Park"]',
      'Resume Test Site',
    );
    await page.locator('[aria-label="Increase count"]').first().click();

    // Navigate away to trigger auto-save
    await page.getByRole('link', { name: 'Your Surveys' }).click();
    await page.waitForURL(/\/app\/surveys$/);

    // Resume the draft
    await page.getByRole('link', { name: 'Resume', exact: true }).click();
    await page.waitForSelector('text=Finish Survey', { state: 'visible' });

    await expect(
      page.locator('[placeholder="e.g. Mission Dolores Park"]'),
    ).toHaveValue('Resume Test Site');
    // The first count button should show 1 (was incremented before navigating away)
    await expect(
      page.locator('[aria-label="Increase count"]').first(),
    ).toContainText('1');
  });

  test('canceling a survey with a draft removes it from the surveys list', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.fill(
      '[placeholder="e.g. Mission Dolores Park"]',
      'Cancel Draft Park',
    );

    // Navigate away to create a draft
    await page.getByRole('link', { name: 'Your Surveys' }).click();
    await page.waitForURL(/\/app\/surveys$/);
    await expect(page.getByText('In progress')).toBeVisible();

    // Resume the draft and cancel it
    await page.getByRole('link', { name: 'Resume' }).click();
    await page.waitForSelector('text=Finish Survey', { state: 'visible' });
    await page.getByRole('button', { name: 'Cancel Survey' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel survey' })
      .click();

    // Canceling navigates to the protocol page; go to surveys list to confirm draft is gone
    await page.getByRole('link', { name: 'Your Surveys' }).click();
    await page.waitForURL(/\/app\/surveys$/);
    await expect(page.getByText('In progress')).not.toBeVisible();
  });

  test('deleting an in-progress draft from Your Surveys removes it', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.fill(
      '[placeholder="e.g. Mission Dolores Park"]',
      'Delete Draft Park',
    );

    // Navigate away to create a draft
    await page.getByRole('link', { name: 'Your Surveys' }).click();
    await page.waitForURL(/\/app\/surveys$/);
    await expect(page.getByText('In progress')).toBeVisible();
    await expect(page.getByText('Delete Draft Park')).toBeVisible();

    // Click the trash icon to open the delete dialog
    await page.getByRole('button', { name: 'Delete survey' }).click();
    await page.waitForSelector('text=Delete this survey?', {
      state: 'visible',
    });

    // Confirm deletion
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect(page.getByText('In progress')).not.toBeVisible();
    await expect(page.getByText('Delete Draft Park')).not.toBeVisible();
  });

  test('deleting a finished pending survey from Your Surveys removes it', async ({
    page,
    protocolRkey,
  }) => {
    // Block the upload endpoint so the survey stays in the pending-upload queue
    await page.route('**/api/surveys', (route) => {
      if (route.request().method() === 'POST') {
        route.abort('failed');
      } else {
        route.continue();
      }
    });

    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.fill(
      '[placeholder="e.g. Mission Dolores Park"]',
      'Delete Finished Park',
    );
    await confirmFinishSurvey(page);

    // Upload failed, so the survey stays in pending-upload and we stay on the survey list
    await page.waitForURL(/\/app\/surveys$/);
    await expect(page.getByText('Pending upload')).toBeVisible();
    await expect(page.getByText('Delete Finished Park')).toBeVisible();

    // Click the trash icon in the pending-upload section
    await page.getByRole('button', { name: 'Delete survey' }).click();
    await page.waitForSelector('text=Delete this survey?', {
      state: 'visible',
    });

    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect(page.getByText('Pending upload')).not.toBeVisible();
    await expect(page.getByText('Delete Finished Park')).not.toBeVisible();
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

// ── Past survey mode ──────────────────────────────────────────────────────────

test('past survey saves the entered date and duration', async ({
  page,
  protocolRkey,
  sql,
}) => {
  await page.goto(`/app/protocols/user-survey-spec/${protocolRkey}`);
  await page.waitForLoadState('networkidle');
  await page.goto(`/app/surveys/new/${protocolRkey}?past=1`);
  await page.waitForSelector('text=Finish Survey', { state: 'visible' });

  await page.fill(
    '[placeholder="e.g. Mission Dolores Park"]',
    'Past Test Site',
  );
  await page.fill('#pastDate', '2026-01-15T10:00');
  await page.fill('#pastDuration', '45');
  await confirmFinishSurvey(page);

  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);

  const [row] = await sql<{ record: Record<string, unknown> }[]>`
    SELECT record FROM surveys WHERE did = 'did:test:survey-spec'
    ORDER BY indexed_at DESC LIMIT 1
  `;

  expect(row.record.eventDate).toBe(new Date('2026-01-15T10:00').toISOString());
  expect(row.record.eventDurationValue).toBe(45);
});

test('taxon-scoped occurrence sets acceptedIdentificationID on the occurrence', async ({
  page,
  sql,
  protocolRkey,
}) => {
  // protocolRkey fixture sets auth cookie for did:test:survey-spec
  // seedProtocol creates target[0] as taxon-scoped (Quercus agrifolia / Coast live oak)
  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

  await page.fill('[placeholder="e.g. Mission Dolores Park"]', 'Test Site');
  // Click "Increase count" for the FIRST target (index 0 = taxon-scoped: Quercus agrifolia)
  await page.locator('[aria-label="Increase count"]').nth(0).click();
  await confirmFinishSurvey(page);

  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);

  const occRows = await sql<{ record: Record<string, unknown> }[]>`
    SELECT record FROM occurrences WHERE did = 'did:test:survey-spec'
  `;
  expect(occRows).toHaveLength(1);
  expect(occRows[0].record.acceptedIdentificationID).toBeDefined();
});

test('verbatim-scoped occurrence does not set acceptedIdentificationID', async ({
  page,
  sql,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

  await page.fill('[placeholder="e.g. Mission Dolores Park"]', 'Test Site');
  // Click "Increase count" for the SECOND target (index 1 = verbatim-scoped: All birds)
  await page.locator('[aria-label="Increase count"]').nth(1).click();
  await confirmFinishSurvey(page);

  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);

  const occRows = await sql<{ record: Record<string, unknown> }[]>`
    SELECT record FROM occurrences WHERE did = 'did:test:survey-spec'
  `;
  expect(occRows).toHaveLength(1);
  expect(occRows[0].record.acceptedIdentificationID).toBeUndefined();
});

test('taxon-scoped occurrence creates an identifications row', async ({
  page,
  sql,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

  await page.fill('[placeholder="e.g. Mission Dolores Park"]', 'Test Site');
  // nth(0) = first target = taxon-scoped (Quercus agrifolia / Coast live oak)
  await page.locator('[aria-label="Increase count"]').nth(0).click();
  await confirmFinishSurvey(page);

  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);

  const identRows = await sql<{ record: Record<string, unknown> }[]>`
    SELECT i.record
    FROM identifications i
    JOIN occurrences o ON o.at_uri = i.occurrence_uri
    WHERE o.did = 'did:test:survey-spec'
  `;
  expect(identRows).toHaveLength(1);
  expect(identRows[0].record.scientificName).toBe('Quercus agrifolia');
  expect(identRows[0].record.vernacularName).toBe('Coast live oak');

  const occRows = await sql<{ record: Record<string, unknown> }[]>`
    SELECT record FROM occurrences WHERE did = 'did:test:survey-spec'
  `;
  expect(occRows).toHaveLength(1);
  expect(occRows[0].record.acceptedIdentificationID).toBeDefined();
});

test('verbatim-scoped occurrence does not create an identifications row', async ({
  page,
  sql,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

  await page.fill('[placeholder="e.g. Mission Dolores Park"]', 'Test Site');
  // nth(1) = second target = verbatim-scoped (All birds)
  await page.locator('[aria-label="Increase count"]').nth(1).click();
  await confirmFinishSurvey(page);

  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);

  const identRows = await sql`
    SELECT * FROM identifications WHERE did = 'did:test:survey-spec'
  `;
  expect(identRows).toHaveLength(0);
});

// ── Incidental occurrences ────────────────────────────────────────────────────

test('incidental occurrence creates Occurrence with no surveyTargetID and an Identification', async ({
  page,
  sql,
  protocolRkey,
}) => {
  // Mock /api/taxa to return a predictable result without hitting iNat
  await page.route('**/api/taxa*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            inatId: 56789,
            scientificName: 'Lupinus chamissonis',
            taxonRank: 'species',
            commonName: 'Silver bush lupine',
            kingdom: 'Plantae',
            taxonID: 'https://www.inaturalist.org/taxa/56789',
          },
        ],
      }),
    });
  });

  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
  await page.fill(
    '[placeholder="e.g. Mission Dolores Park"]',
    'Incidental Test Site',
  );

  await page.getByRole('button', { name: 'Add incidental' }).click();
  await page.getByPlaceholder('Search taxa…').fill('Lupinus');

  await page.waitForSelector('text=Silver bush lupine', { state: 'visible' });
  await page.getByRole('button', { name: /Silver bush lupine/ }).click();

  // Taxon is selected; confirm by clicking Add
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(
    page.locator('ul li').filter({ hasText: 'Silver bush lupine' }),
  ).toBeVisible();

  // Finish the survey
  await confirmFinishSurvey(page);
  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);

  // Verify the detail page renders the Incidentals section
  await expect(
    page.getByRole('heading', { name: /Incidentals/ }),
  ).toBeVisible();

  // Verify Occurrence has no surveyTargetID and has acceptedIdentificationID
  const occRows = await sql<{ record: Record<string, unknown> }[]>`
    SELECT record FROM occurrences WHERE did = 'did:test:survey-spec'
  `;
  const incidentalOcc = occRows.find((o) => !o.record.surveyTargetID);
  expect(incidentalOcc).toBeDefined();
  expect(incidentalOcc?.record.taxonID).toBe(
    'https://www.inaturalist.org/taxa/56789',
  );
  expect(incidentalOcc?.record.acceptedIdentificationID).toBeDefined();

  // Verify Identification record
  const identRows = await sql<{ record: Record<string, unknown> }[]>`
    SELECT i.record
    FROM identifications i
    JOIN occurrences o ON o.at_uri = i.occurrence_uri
    WHERE o.did = 'did:test:survey-spec'
      AND o.record->>'surveyTargetID' IS NULL
  `;
  expect(identRows).toHaveLength(1);
  expect(identRows[0].record.scientificName).toBe('Lupinus chamissonis');
  expect(identRows[0].record.vernacularName).toBe('Silver bush lupine');
});

test('finish dialog warns about unresolved incidentals', async ({
  page,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
  await page.fill(
    '[placeholder="e.g. Mission Dolores Park"]',
    'Warning Test Site',
  );

  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByRole('button', { name: 'Add incidental' }).click();
  await page.waitForSelector('[placeholder="e.g. small brown bird"]', {
    state: 'visible',
  });
  await page.fill('[placeholder="e.g. small brown bird"]', 'mystery bird');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await page.getByRole('button', { name: 'Finish Survey' }).click();
  await expect(
    page.getByRole('alertdialog').getByText(/incidental without taxa/i),
  ).toBeVisible();
});

test('can finish a survey with unresolved incidentals', async ({
  page,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
  await page.fill(
    '[placeholder="e.g. Mission Dolores Park"]',
    'Unresolved Test Site',
  );

  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByRole('button', { name: 'Add incidental' }).click();
  await page.waitForSelector('[placeholder="e.g. small brown bird"]', {
    state: 'visible',
  });
  await page.fill('[placeholder="e.g. small brown bird"]', 'mystery bird');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('mystery bird')).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('button', { name: 'Finish Survey' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();

  await page.waitForURL(/\/app\/surveys$/);
  await expect(page.getByText('Needs attention')).toBeVisible();
});

test('completed survey with unresolved incidentals does not appear in pending-upload section', async ({
  page,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
  await page.fill(
    '[placeholder="e.g. Mission Dolores Park"]',
    'Unresolved Upload Test',
  );

  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByRole('button', { name: 'Add incidental' }).click();
  await page.waitForSelector('[placeholder="e.g. small brown bird"]', {
    state: 'visible',
  });
  await page.fill('[placeholder="e.g. small brown bird"]', 'mystery bird');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await page.getByRole('button', { name: 'Finish Survey' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();

  await page.waitForURL(/\/app\/surveys$/);
  await expect(page.getByText('Pending upload')).not.toBeVisible();
});

test('resuming a completed survey restores original timing as past mode', async ({
  page,
  protocolRkey,
}) => {
  await page.goto(`/app/protocols/user-survey-spec/${protocolRkey}`);
  await page.waitForLoadState('networkidle');
  await page.goto(`/app/surveys/new/${protocolRkey}?past=1`);
  await page.waitForSelector('text=Finish Survey', { state: 'visible' });

  await page.fill(
    '[placeholder="e.g. Mission Dolores Park"]',
    'Timing Test Site',
  );
  await page.fill('#pastDate', '2026-03-15T09:30');
  await page.fill('#pastDuration', '30');

  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByRole('button', { name: 'Add incidental' }).click();
  await page.waitForSelector('[placeholder="e.g. small brown bird"]', {
    state: 'visible',
  });
  await page.fill('[placeholder="e.g. small brown bird"]', 'mystery warbler');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await page.getByRole('button', { name: 'Finish Survey' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.waitForURL(/\/app\/surveys$/);

  await page.getByRole('link', { name: 'Resolve' }).click();
  await page.waitForSelector('text=Finish Survey', { state: 'visible' });

  await expect(page.locator('#pastDate')).toHaveValue('2026-03-15T09:30');
  await expect(page.locator('#pastDuration')).toHaveValue('30');
});

test('finish dialog shows past duration instead of elapsed clock when resuming a complete survey', async ({
  page,
  protocolRkey,
}) => {
  await page.goto(`/app/protocols/user-survey-spec/${protocolRkey}`);
  await page.waitForLoadState('networkidle');
  await page.goto(`/app/surveys/new/${protocolRkey}?past=1`);
  await page.waitForSelector('text=Finish Survey', { state: 'visible' });

  await page.fill(
    '[placeholder="e.g. Mission Dolores Park"]',
    'Clock Test Site',
  );
  await page.fill('#pastDate', '2026-03-15T09:30');
  await page.fill('#pastDuration', '30');

  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByRole('button', { name: 'Add incidental' }).click();
  await page.waitForSelector('[placeholder="e.g. small brown bird"]', {
    state: 'visible',
  });
  await page.fill('[placeholder="e.g. small brown bird"]', 'mystery warbler');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await page.getByRole('button', { name: 'Finish Survey' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.waitForURL(/\/app\/surveys$/);

  await page.getByRole('link', { name: 'Resolve' }).click();
  await page.waitForSelector('text=Finish Survey', { state: 'visible' });

  await page.getByRole('button', { name: 'Finish Survey' }).click();
  await expect(page.getByRole('alertdialog').getByText('30 min')).toBeVisible();
});

test('finish dialog says "Keep editing" instead of "Keep going" when resuming a complete survey', async ({
  page,
  protocolRkey,
}) => {
  await page.goto(`/app/protocols/user-survey-spec/${protocolRkey}`);
  await page.waitForLoadState('networkidle');
  await page.goto(`/app/surveys/new/${protocolRkey}?past=1`);
  await page.waitForSelector('text=Finish Survey', { state: 'visible' });

  await page.fill(
    '[placeholder="e.g. Mission Dolores Park"]',
    'Keep Editing Site',
  );
  await page.fill('#pastDate', '2026-03-15T09:30');
  await page.fill('#pastDuration', '30');

  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByRole('button', { name: 'Add incidental' }).click();
  await page.waitForSelector('[placeholder="e.g. small brown bird"]', {
    state: 'visible',
  });
  await page.fill('[placeholder="e.g. small brown bird"]', 'mystery warbler');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await page.getByRole('button', { name: 'Finish Survey' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.waitForURL(/\/app\/surveys$/);

  await page.getByRole('link', { name: 'Resolve' }).click();
  await page.waitForSelector('text=Finish Survey', { state: 'visible' });

  await page.getByRole('button', { name: 'Finish Survey' }).click();
  await expect(
    page.getByRole('button', { name: 'Keep editing' }),
  ).toBeVisible();
});

test('editing an incidental allows updating the taxon via autocomplete', async ({
  page,
  protocolRkey,
}) => {
  await page.route('**/api/taxa*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            inatId: 56789,
            scientificName: 'Lupinus chamissonis',
            taxonRank: 'species',
            commonName: 'Silver bush lupine',
            kingdom: 'Plantae',
            taxonID: 'https://www.inaturalist.org/taxa/56789',
          },
        ],
      }),
    });
  });

  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
  await page.fill(
    '[placeholder="e.g. Mission Dolores Park"]',
    'Edit Test Site',
  );

  // Add a verbatim incidental offline
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByRole('button', { name: 'Add incidental' }).click();
  await page.getByPlaceholder('e.g. small brown bird').fill('mystery bird');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('mystery bird')).toBeVisible();

  // Go back online and open the edit dialog
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page
    .locator('ul li')
    .filter({ hasText: 'mystery bird' })
    .getByRole('button')
    .first()
    .click();

  // Edit dialog shows the autocomplete input for changing the taxon
  await expect(page.getByPlaceholder('Search taxa…')).toBeVisible();

  // Search for and select a new taxon
  await page.getByPlaceholder('Search taxa…').fill('Lupinus');
  await page.waitForSelector('text=Silver bush lupine', { state: 'visible' });
  await page.getByRole('button', { name: /Silver bush lupine/ }).click();

  // Selected taxon is shown, autocomplete is still present for further changes
  await expect(
    page.getByRole('dialog').getByText('Silver bush lupine'),
  ).toBeVisible();

  // Save the edit
  await page.getByRole('button', { name: 'Save' }).click();

  // Updated taxon appears in the incidentals list
  await expect(
    page.locator('ul li').filter({ hasText: 'Silver bush lupine' }),
  ).toBeVisible();
  await expect(page.getByText('mystery bird')).not.toBeVisible();
});

test('editing a placeholder incidental pre-populates the taxon autocomplete', async ({
  page,
  protocolRkey,
}) => {
  await page.route('**/api/taxa*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
  await page.fill('[placeholder="e.g. Mission Dolores Park"]', 'Test Site');

  // Add a verbatim incidental offline
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByRole('button', { name: 'Add incidental' }).click();
  await page.getByPlaceholder('e.g. small brown bird').fill('mystery bird');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('mystery bird')).toBeVisible();

  // Go back online and open the edit dialog
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page
    .locator('ul li')
    .filter({ hasText: 'mystery bird' })
    .getByRole('button')
    .first()
    .click();

  // Autocomplete should be pre-populated with the placeholder text
  await expect(page.getByPlaceholder('Search taxa…')).toHaveValue(
    'mystery bird',
  );
});

test('existing protocol occurrence tests are unaffected by incidentals changes', async ({
  page,
  sql,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
  await page.fill(
    '[placeholder="e.g. Mission Dolores Park"]',
    'Regression Test Site',
  );
  await page.locator('[aria-label="Increase count"]').nth(0).click();
  await confirmFinishSurvey(page);

  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);

  const occRows = await sql<{ record: Record<string, unknown> }[]>`
    SELECT record FROM occurrences WHERE did = 'did:test:survey-spec'
  `;
  // Only the protocol target occurrence — no incidentals
  expect(occRows).toHaveLength(1);
  expect(occRows[0].record.surveyTargetID).toBeDefined();

  // nth(0) is the taxon-scoped target (Quercus agrifolia), so an identification
  // row should be created — verify it's present and unaffected
  const identRows = await sql<{ record: Record<string, unknown> }[]>`
    SELECT record FROM identifications WHERE did = 'did:test:survey-spec'
  `;
  expect(identRows).toHaveLength(1);
  expect(identRows[0].record.scientificName).toBe('Quercus agrifolia');
});

// ── Race condition: auto-save orphan after successful submit ──────────────────

test('does not leave an orphaned in-progress draft when auto-save fires during navigation after submit', async ({
  page,
  protocolRkey,
}) => {
  // Install fake clock before any navigation so the form's setInterval is
  // registered under the fake clock and we can fire it on demand.
  await page.clock.install({ time: Date.now() });

  // Delay the survey detail GET so goto() stays pending long enough for
  // us to advance the clock and fire the auto-save interval after deletion.
  await page.route('**/api/surveys/user-survey-spec/**', async (route) => {
    if (route.request().method() === 'GET') {
      await new Promise<void>((r) => setTimeout(r, 800));
    }
    await route.continue();
  });

  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
  await page.fill(
    '[placeholder="e.g. Mission Dolores Park"]',
    'Race Condition Site',
  );

  // Fire the 10s auto-save interval to create a draft in IDB with complete: false.
  await page.clock.runFor(11_000);

  // Wait for the IDB write to settle before submitting.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const req = indexedDB.open('cuanto');
              req.onsuccess = () => {
                const tx = req.result.transaction(
                  'pending-surveys',
                  'readonly',
                );
                const countReq = tx.objectStore('pending-surveys').count();
                countReq.onsuccess = () => resolve(countReq.result);
                countReq.onerror = () => resolve(0);
              };
              req.onerror = () => resolve(0);
            }),
        ),
      { timeout: 5_000 },
    )
    .toBe(1);

  // Submit. The upload succeeds quickly, deletePendingSurvey runs, then
  // goto() starts and blocks on the delayed survey detail GET (800ms real).
  await page.getByRole('button', { name: 'Finish Survey' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();

  // Let the upload and delete complete in real time (~100ms on localhost).
  // goto() is now awaiting the delayed GET response.
  await page.waitForTimeout(300);

  // Fire the auto-save interval again. Without the fix, autoSave() runs,
  // calls updatePendingSurvey with complete: false, and re-inserts the
  // deleted draft as an orphan because navigatingAway is not checked.
  await page.clock.runFor(11_000);

  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/, {
    timeout: 10_000,
  });

  const pending = await page.evaluate(
    () =>
      new Promise<unknown[]>((resolve) => {
        const req = indexedDB.open('cuanto');
        req.onsuccess = () => {
          const tx = req.result.transaction('pending-surveys', 'readonly');
          const getAllReq = tx.objectStore('pending-surveys').getAll();
          getAllReq.onsuccess = () => resolve(getAllReq.result);
        };
      }),
  );

  expect(pending).toHaveLength(0);
});

// ── Survey ordering ───────────────────────────────────────────────────────────

const ORDER_DID = 'did:test:survey-order-spec';

test('GET /api/surveys returns surveys ordered by createdAt DESC', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: ORDER_DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  await teardownDid(sql, ORDER_DID);
  const { protocolRkey } = await seedProtocol(sql, ORDER_DID);
  const protocolUri = `at://${ORDER_DID}/bio.lexicons.temp.v0-1.surveyProtocol/${protocolRkey}`;

  const older = '2026-01-01T00:00:00.000Z';
  const newer = '2026-06-01T00:00:00.000Z';

  // Seed older survey first, then newer, to confirm DB insertion order doesn't
  // determine result order.
  await seedSurvey(sql, ORDER_DID, protocolUri, 'Older Site', older);
  await seedSurvey(sql, ORDER_DID, protocolUri, 'Newer Site', newer);

  try {
    const res = await page.request.get('/api/surveys');
    expect(res.ok()).toBe(true);
    const surveys = await res.json();
    expect(surveys).toHaveLength(2);
    expect(surveys[0].record.createdAt).toBe(newer);
    expect(surveys[1].record.createdAt).toBe(older);
  } finally {
    await teardownDid(sql, ORDER_DID);
  }
});

// ── Edit route ───────────────────────────────────────────────────────────────

const EDIT_DID = 'did:test:survey-edit-route';
const EDIT_HANDLE = 'user-survey-edit-route';

test('survey detail page shows Edit link for owner', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: EDIT_DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
  const protocolUri = `at://${EDIT_DID}/bio.lexicons.temp.v0-1.surveyProtocol/${protocolRkey}`;
  const { surveyRkey } = await seedSurvey(
    sql,
    EDIT_DID,
    protocolUri,
    'Edit Route Test',
  );

  try {
    // Cache protocol in IDB before visiting the survey detail page
    await page.goto(`/app/protocols/${EDIT_HANDLE}/${protocolRkey}`);
    await page.waitForLoadState('networkidle');
    await page.goto(`/app/surveys/${EDIT_HANDLE}/${surveyRkey}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('link', { name: 'Edit' })).toBeVisible();
  } finally {
    await teardownDid(sql, EDIT_DID);
  }
});

test('edit page saves updated location name', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: EDIT_DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
  const protocolUri = `at://${EDIT_DID}/bio.lexicons.temp.v0-1.surveyProtocol/${protocolRkey}`;
  const { surveyRkey } = await seedSurvey(
    sql,
    EDIT_DID,
    protocolUri,
    'Original Name',
  );

  try {
    // Cache protocol in IDB before visiting the edit page
    await page.goto(`/app/protocols/${EDIT_HANDLE}/${protocolRkey}`);
    await page.waitForLoadState('networkidle');
    await page.goto(`/app/surveys/${EDIT_HANDLE}/${surveyRkey}/edit`);
    await page.waitForSelector('[placeholder="e.g. Mission Dolores Park"]', {
      state: 'visible',
    });

    await page.fill(
      '[placeholder="e.g. Mission Dolores Park"]',
      'Updated Name',
    );
    await page.getByRole('button', { name: 'Save Survey' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page).toHaveURL(
      new RegExp(`/app/surveys/${EDIT_HANDLE}/${surveyRkey}`),
    );
    await expect(page.getByText('Updated Name')).toBeVisible();
  } finally {
    await teardownDid(sql, EDIT_DID);
  }
});

test('/app/surveys renders surveys in createdAt DESC order', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: ORDER_DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  await teardownDid(sql, ORDER_DID);
  const { protocolRkey } = await seedProtocol(sql, ORDER_DID);
  const protocolUri = `at://${ORDER_DID}/bio.lexicons.temp.v0-1.surveyProtocol/${protocolRkey}`;

  // Seed older first to confirm insertion order doesn't determine display order.
  await seedSurvey(
    sql,
    ORDER_DID,
    protocolUri,
    'Older Site',
    '2026-01-01T00:00:00.000Z',
  );
  await seedSurvey(
    sql,
    ORDER_DID,
    protocolUri,
    'Newer Site',
    '2026-06-01T00:00:00.000Z',
  );

  try {
    await page.goto('/app/surveys');
    await page.waitForLoadState('networkidle');

    const items = page.locator('ul').last().locator('li');
    await expect(items.nth(0)).toContainText('Newer Site');
    await expect(items.nth(1)).toContainText('Older Site');
  } finally {
    await teardownDid(sql, ORDER_DID);
  }
});

const COORDS_DID = 'did:test:survey-spec-coords';
const COORDS_HANDLE = 'user-survey-spec-coords';

test('survey detail shows coordinates and map when survey has geo location', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: COORDS_DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const { protocolRkey } = await seedProtocol(sql, COORDS_DID);
  const protocolUri = `at://${COORDS_DID}/bio.lexicons.temp.v0-1.surveyProtocol/${protocolRkey}`;
  const { surveyRkey } = await seedSurveyWithCoordinates(
    sql,
    COORDS_DID,
    protocolUri,
    'Geo Test Park',
    '37.7749',
    '-122.4194',
  );

  try {
    await page.goto(`/app/protocols/${COORDS_HANDLE}/${protocolRkey}`);
    await page.waitForLoadState('networkidle');
    await page.goto(`/app/surveys/${COORDS_HANDLE}/${surveyRkey}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('37.7749, -122.4194')).toBeVisible();
    await expect(page.locator('[data-testid="geo-map"]')).toBeVisible();
  } finally {
    await teardownDid(sql, COORDS_DID);
  }
});

test('survey detail does not show coordinates or map when survey has no geo location', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: COORDS_DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const { protocolRkey } = await seedProtocol(sql, COORDS_DID);
  const protocolUri = `at://${COORDS_DID}/bio.lexicons.temp.v0-1.surveyProtocol/${protocolRkey}`;
  const { surveyRkey } = await seedSurvey(
    sql,
    COORDS_DID,
    protocolUri,
    'No Coords Park',
  );

  try {
    await page.goto(`/app/protocols/${COORDS_HANDLE}/${protocolRkey}`);
    await page.waitForLoadState('networkidle');
    await page.goto(`/app/surveys/${COORDS_HANDLE}/${surveyRkey}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Coordinates:')).not.toBeVisible();
    await expect(page.locator('[data-testid="geo-map"]')).not.toBeVisible();
  } finally {
    await teardownDid(sql, COORDS_DID);
  }
});
