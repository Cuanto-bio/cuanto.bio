import { expect, test } from '../fixtures.js';
import { cacheAndOpenNewSurvey, confirmFinishSurvey } from './helpers.js';

// ── Taxon and verbatim occurrences ────────────────────────────────────────────

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
