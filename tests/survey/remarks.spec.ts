import { expect, seedProtocol, teardownDid, test } from '../fixtures.js';
import { cacheAndOpenNewSurvey, confirmFinishSurvey } from './helpers.js';

const HANDLE = 'user-survey-spec';
const LOCATION_PLACEHOLDER = '[placeholder="e.g. Mission Dolores Park"]';
const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/';
const CC_BY = 'https://creativecommons.org/licenses/by/4.0/';

test('a survey remark is written as its own record and shown on the detail page', async ({
  page,
  sql,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, HANDLE, protocolRkey);

  await page.fill(LOCATION_PLACEHOLDER, 'Remark Test Park');
  await page.getByLabel('Remarks').fill('Heavy fog until 10am.');
  await confirmFinishSurvey(page);

  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);
  await expect(page.getByText('Heavy fog until 10am.')).toBeVisible();
  // Defaults to CC0 until the surveyor picks something else on /app/account.
  await expect(page.getByRole('link', { name: 'CC0 1.0' })).toBeVisible();

  const rkey = page.url().split('/').pop();
  const [remark] = await sql<
    {
      at_uri: string;
      subject_uri: string;
      dwc_term: string;
      record: Record<string, unknown>;
    }[]
  >`SELECT at_uri, subject_uri, dwc_term, record FROM remarks WHERE did = 'did:test:survey-spec'`;
  expect(remark).toBeTruthy();
  // Reuses the survey's own rkey in the remark collection, and names the
  // survey as its subject.
  expect(remark.at_uri).toBe(
    `at://did:test:survey-spec/bio.lexicons.temp.v0-1.remark/${rkey}`,
  );
  expect(remark.subject_uri).toBe(
    `at://did:test:survey-spec/bio.cuanto.survey/${rkey}`,
  );
  expect(remark.dwc_term).toBe('eventRemarks');
  expect(remark.record.license).toBe(CC0);

  // The survey's forward reference is what makes the remark count.
  const [survey] = await sql<{ record: { eventRemarksID?: string } }[]>`
    SELECT record FROM surveys WHERE did = 'did:test:survey-spec'
  `;
  expect(survey.record.eventRemarksID).toBe(remark.at_uri);
});

test('a remark renders bold, italics and links, keeping line breaks', async ({
  page,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, HANDLE, protocolRkey);
  await page.fill(LOCATION_PLACEHOLDER, 'Formatted Remark Park');
  await page
    .getByLabel('Remarks')
    .fill('Heavy **fog**, mostly *Quercus*.\nPhotos: https://cuanto.bio');
  await confirmFinishSurvey(page);
  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);

  const remark = page.locator('p', { hasText: 'Heavy' });
  await expect(remark.locator('strong')).toHaveText('fog');
  await expect(remark.locator('em')).toHaveText('Quercus');
  await expect(remark.getByRole('link')).toHaveAttribute(
    'href',
    'https://cuanto.bio',
  );
  // Markers gone, the typed line break kept, and no stray whitespace from the
  // template leaking into the pre-wrap element.
  expect(await remark.innerText()).toBe(
    'Heavy fog, mostly Quercus.\nPhotos: https://cuanto.bio',
  );
});

test('a remark over the lexicon byte limit is caught on the form', async ({
  page,
  sql,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, HANDLE, protocolRkey);

  await page.fill(LOCATION_PLACEHOLDER, 'Long Remark Park');
  // 1001 characters fit the textarea's maxlength, but at three UTF-8 bytes
  // each they exceed the lexicon's 3000-byte limit.
  await page.getByLabel('Remarks').fill('あ'.repeat(1001));
  await confirmFinishSurvey(page);

  await expect(page.getByText('Remarks are too long')).toBeVisible();
  await expect(page).toHaveURL(/\/new/);
  const rows =
    await sql`SELECT at_uri FROM surveys WHERE did = 'did:test:survey-spec'`;
  expect(rows).toHaveLength(0);
});

test('a survey saved without a remark writes no remark record', async ({
  page,
  sql,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, HANDLE, protocolRkey);

  await page.fill(LOCATION_PLACEHOLDER, 'No Remark Park');
  await confirmFinishSurvey(page);

  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);
  const rows =
    await sql`SELECT at_uri FROM remarks WHERE did = 'did:test:survey-spec'`;
  expect(rows).toHaveLength(0);
});

test('editing a survey updates its remark, and clearing it deletes the record', async ({
  page,
  sql,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, HANDLE, protocolRkey);
  await page.fill(LOCATION_PLACEHOLDER, 'Edit Remark Park');
  await page.getByLabel('Remarks').fill('First draft.');
  await confirmFinishSurvey(page);
  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);
  const rkey = page.url().split('/').pop();

  // Edit the remark.
  await page.goto(`/app/surveys/${HANDLE}/${rkey}/edit`);
  await page.waitForSelector(LOCATION_PLACEHOLDER, { state: 'visible' });
  await expect(page.getByLabel('Remarks')).toHaveValue('First draft.');
  await page.getByLabel('Remarks').fill('Second draft.');
  await page.getByRole('button', { name: 'Save Survey' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Second draft.')).toBeVisible();

  const [updated] = await sql<{ record: { body: string } }[]>`
    SELECT record FROM remarks WHERE did = 'did:test:survey-spec'
  `;
  expect(updated.record.body).toBe('Second draft.');

  // Clearing the textarea deletes the record rather than publishing an empty
  // one, and drops the survey's reference to it.
  await page.goto(`/app/surveys/${HANDLE}/${rkey}/edit`);
  await page.waitForSelector(LOCATION_PLACEHOLDER, { state: 'visible' });
  await page.getByLabel('Remarks').fill('');
  await page.getByRole('button', { name: 'Save Survey' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  // Anchored: /edit also matches an unanchored regex, which would hide a save
  // that never left the form.
  await expect(page).toHaveURL(
    new RegExp(`/app/surveys/${HANDLE}/${rkey}(\\?|$)`),
  );
  await expect(page.getByText('Second draft.')).not.toBeVisible();

  const rows =
    await sql`SELECT at_uri FROM remarks WHERE did = 'did:test:survey-spec'`;
  expect(rows).toHaveLength(0);
  const [survey] = await sql<{ record: { eventRemarksID?: string } }[]>`
    SELECT record FROM surveys WHERE did = 'did:test:survey-spec'
  `;
  expect(survey.record.eventRemarksID).toBeUndefined();
});

test('deleting a survey deletes its remark too', async ({
  page,
  sql,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, HANDLE, protocolRkey);
  await page.fill(LOCATION_PLACEHOLDER, 'Doomed Park');
  await page.getByLabel('Remarks').fill('This goes away.');
  await confirmFinishSurvey(page);
  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);
  const rkey = page.url().split('/').pop();

  const resp = await page.request.delete(`/api/surveys/${HANDLE}/${rkey}`);
  expect(resp.status()).toBe(204);

  const rows =
    await sql`SELECT at_uri FROM remarks WHERE did = 'did:test:survey-spec'`;
  expect(rows).toHaveLength(0);
});

const LICENSE_DID = 'did:test:survey-remark-license';
const LICENSE_HANDLE = 'user-survey-remark-license';

test('the account default license is stamped onto new remarks', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: LICENSE_DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const { protocolRkey } = await seedProtocol(sql, LICENSE_DID);

  try {
    await page.goto('/app/account');
    await page.getByLabel('Default license for your remarks').click();
    await page.getByRole('option', { name: 'Creative Commons BY 4.0' }).click();
    await expect
      .poll(async () => {
        const [user] = await sql<{ default_remark_license: string | null }[]>`
          SELECT default_remark_license FROM users WHERE did = ${LICENSE_DID}
        `;
        return user?.default_remark_license;
      })
      .toBe(CC_BY);

    await cacheAndOpenNewSurvey(page, LICENSE_HANDLE, protocolRkey);
    await page.fill(LOCATION_PLACEHOLDER, 'Licensed Park');
    await page.getByLabel('Remarks').fill('Mine, with credit.');
    await confirmFinishSurvey(page);
    await expect(page).toHaveURL(
      new RegExp(`/app/surveys/${LICENSE_HANDLE}/\\w+`),
    );

    const [remark] = await sql<{ record: { license?: string } }[]>`
      SELECT record FROM remarks WHERE did = ${LICENSE_DID}
    `;
    expect(remark.record.license).toBe(CC_BY);
    await expect(page.getByRole('link', { name: 'CC BY 4.0' })).toBeVisible();
  } finally {
    await teardownDid(sql, LICENSE_DID);
  }
});

const CC_BY_NC = 'https://creativecommons.org/licenses/by-nc/4.0/';

test('a license picked on the form is stamped onto the remark', async ({
  page,
  sql,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, HANDLE, protocolRkey);
  await page.fill(LOCATION_PLACEHOLDER, 'Picked License Park');
  await page.getByLabel('Remarks').fill('Credit me.');
  await page.getByLabel('License').click();
  await page
    .getByRole('option', { name: 'Creative Commons BY-NC 4.0' })
    .click();
  await confirmFinishSurvey(page);
  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);

  const [remark] = await sql<{ record: { license?: string } }[]>`
    SELECT record FROM remarks WHERE did = 'did:test:survey-spec'
  `;
  expect(remark.record.license).toBe(CC_BY_NC);
  await expect(page.getByRole('link', { name: 'CC BY-NC 4.0' })).toBeVisible();
});

test('editing a remark keeps its license, and changing only the license rewrites it', async ({
  page,
  sql,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, HANDLE, protocolRkey);
  await page.fill(LOCATION_PLACEHOLDER, 'Relicensed Park');
  await page.getByLabel('Remarks').fill('First draft.');
  await page.getByLabel('License').click();
  await page
    .getByRole('option', { name: 'Creative Commons BY-NC 4.0' })
    .click();
  await confirmFinishSurvey(page);
  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);
  const rkey = page.url().split('/').pop();

  // Editing only the text must not reset the license to the account default.
  await page.goto(`/app/surveys/${HANDLE}/${rkey}/edit`);
  await page.waitForSelector(LOCATION_PLACEHOLDER, { state: 'visible' });
  await expect(page.getByLabel('License')).toHaveText('CC BY-NC 4.0');
  await page.getByLabel('Remarks').fill('Second draft.');
  await page.getByRole('button', { name: 'Save Survey' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Second draft.')).toBeVisible();

  const [edited] = await sql<{ record: { body: string; license?: string } }[]>`
    SELECT record FROM remarks WHERE did = 'did:test:survey-spec'
  `;
  expect(edited.record.body).toBe('Second draft.');
  expect(edited.record.license).toBe(CC_BY_NC);

  // Changing only the license still rewrites the record.
  await page.goto(`/app/surveys/${HANDLE}/${rkey}/edit`);
  await page.waitForSelector(LOCATION_PLACEHOLDER, { state: 'visible' });
  await page.getByLabel('License').click();
  await page.getByRole('option', { name: 'Creative Commons BY 4.0' }).click();
  await page.getByRole('button', { name: 'Save Survey' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('link', { name: 'CC BY 4.0' })).toBeVisible();

  const [relicensed] = await sql<
    { record: { body: string; license?: string } }[]
  >`SELECT record FROM remarks WHERE did = 'did:test:survey-spec'`;
  expect(relicensed.record.body).toBe('Second draft.');
  expect(relicensed.record.license).toBe(CC_BY);
});
