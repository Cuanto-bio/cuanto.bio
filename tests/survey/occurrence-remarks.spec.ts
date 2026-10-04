import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures.js';
import { cacheAndOpenNewSurvey, confirmFinishSurvey } from './helpers.js';

const HANDLE = 'user-survey-spec';
const DID = 'did:test:survey-spec';
const LOCATION_PLACEHOLDER = '[placeholder="e.g. Mission Dolores Park"]';
const OCC_NSID = 'bio.lexicons.temp.v0-1.occurrence';
const REMARK_NSID = 'bio.lexicons.temp.v0-1.remark';

function targetRow(page: Page) {
  return page.locator('li').filter({ hasText: 'Quercus agrifolia' });
}

// Opens the target's sheet, sets its count and remark, and closes it.
async function editTarget(page: Page, qty: string, remark: string) {
  await targetRow(page).getByRole('button').first().click();
  await page.locator('#organism-qty').fill(qty);
  await page.locator('#occurrence-remark').fill(remark);
  await page.getByRole('button', { name: 'Done' }).click();
}

async function saveEdit(page: Page, rkey: string | undefined) {
  await page.getByRole('button', { name: 'Save Survey' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  // Anchored: /edit also matches an unanchored regex, which would hide a save
  // that never left the form.
  await expect(page).toHaveURL(
    new RegExp(`/app/surveys/${HANDLE}/${rkey}(\\?|$)`),
  );
}

async function openEdit(page: Page, rkey: string | undefined) {
  await page.goto(`/app/surveys/${HANDLE}/${rkey}/edit`);
  await page.waitForSelector(LOCATION_PLACEHOLDER, { state: 'visible' });
}

test('a remark on a counted target is written as its own record and shown on the survey', async ({
  page,
  sql,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, HANDLE, protocolRkey);
  await page.fill(LOCATION_PLACEHOLDER, 'Occurrence Remark Park');
  await editTarget(page, '2', 'One sapling by the gate.');
  // The row signals that the target carries a remark.
  await expect(targetRow(page).getByLabel('Has remarks')).toBeVisible();
  await confirmFinishSurvey(page);

  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);
  await expect(page.getByText('One sapling by the gate.')).toBeVisible();

  const [occ] = await sql<
    { at_uri: string; rkey: string; record: { occurrenceRemarksID?: string } }[]
  >`SELECT at_uri, rkey, record FROM occurrences WHERE did = ${DID}`;
  const [remark] = await sql<
    { at_uri: string; subject_uri: string; dwc_term: string }[]
  >`SELECT at_uri, subject_uri, dwc_term FROM remarks WHERE did = ${DID}`;
  // Reuses the occurrence's rkey in the remark collection, names the
  // occurrence as its subject, and is what the occurrence points at.
  expect(remark.at_uri).toBe(`at://${DID}/${REMARK_NSID}/${occ.rkey}`);
  expect(remark.subject_uri).toBe(`at://${DID}/${OCC_NSID}/${occ.rkey}`);
  expect(remark.dwc_term).toBe('occurrenceRemarks');
  expect(occ.record.occurrenceRemarksID).toBe(remark.at_uri);
});

test('editing a target remark rewrites it, and clearing it deletes the record', async ({
  page,
  sql,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, HANDLE, protocolRkey);
  await page.fill(LOCATION_PLACEHOLDER, 'Edit Occurrence Remark Park');
  await editTarget(page, '2', 'First draft.');
  await confirmFinishSurvey(page);
  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);
  const rkey = page.url().split('/').pop();

  await openEdit(page, rkey);
  await targetRow(page).getByRole('button').first().click();
  await expect(page.locator('#occurrence-remark')).toHaveValue('First draft.');
  await page.locator('#occurrence-remark').fill('Second draft.');
  await page.getByRole('button', { name: 'Done' }).click();
  await saveEdit(page, rkey);
  await expect(page.getByText('Second draft.')).toBeVisible();

  const [updated] = await sql<{ record: { body: string } }[]>`
    SELECT record FROM remarks WHERE did = ${DID}
  `;
  expect(updated.record.body).toBe('Second draft.');

  await openEdit(page, rkey);
  await editTarget(page, '2', '');
  await saveEdit(page, rkey);
  await expect(page.getByText('Second draft.')).not.toBeVisible();

  expect(await sql`SELECT at_uri FROM remarks WHERE did = ${DID}`).toHaveLength(
    0,
  );
  const [occ] = await sql<{ record: { occurrenceRemarksID?: string } }[]>`
    SELECT record FROM occurrences WHERE did = ${DID}
  `;
  expect(occ.record.occurrenceRemarksID).toBeUndefined();
});

test('removing a target from a survey deletes its remark too', async ({
  page,
  sql,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, HANDLE, protocolRkey);
  await page.fill(LOCATION_PLACEHOLDER, 'Remove Occurrence Remark Park');
  await editTarget(page, '2', 'Soon gone.');
  await confirmFinishSurvey(page);
  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);
  const rkey = page.url().split('/').pop();

  await openEdit(page, rkey);
  await targetRow(page).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Reset' }).click();
  await saveEdit(page, rkey);

  expect(
    await sql`SELECT at_uri FROM occurrences WHERE did = ${DID}`,
  ).toHaveLength(0);
  expect(await sql`SELECT at_uri FROM remarks WHERE did = ${DID}`).toHaveLength(
    0,
  );
});

test('the target remark field is only enabled once the target has a count', async ({
  page,
  protocolRkey,
}) => {
  // A target without a count gets no occurrence, so there would be nothing
  // for the remark to describe; text typed there would be silently dropped.
  await cacheAndOpenNewSurvey(page, HANDLE, protocolRkey);
  await targetRow(page).getByRole('button').first().click();
  const remark = page.locator('#occurrence-remark');
  await expect(remark).toBeDisabled();

  await page.locator('#organism-qty').fill('1');
  await expect(remark).toBeEnabled();

  await page.locator('#organism-qty').fill('0');
  await expect(remark).toBeDisabled();
});

test('editing remark text keeps a license we do not offer', async ({
  page,
  sql,
  protocolRkey,
}) => {
  // Another client may publish a remark under any license. Fixing a typo in
  // it here must not republish the author's words under a different one.
  const CUSTOM = 'https://example.org/licenses/custom';
  await cacheAndOpenNewSurvey(page, HANDLE, protocolRkey);
  await page.fill(LOCATION_PLACEHOLDER, 'Custom License Park');
  await page.locator('#eventRemark').fill('Survey draft.');
  await editTarget(page, '2', 'Target draft.');
  await confirmFinishSurvey(page);
  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);
  const rkey = page.url().split('/').pop();
  await sql`
    UPDATE remarks SET record = jsonb_set(record, '{license}', ${sql.json(CUSTOM)})
    WHERE did = ${DID}
  `;

  // The edit page renders its cached copy and refreshes it in the background,
  // so let that refresh land before reading the form.
  const refreshed = page.waitForResponse(
    (r) => r.url().endsWith(`/api/surveys/${HANDLE}/${rkey}`) && r.ok(),
  );
  await openEdit(page, rkey);
  await refreshed;
  await page.reload();
  await page.waitForSelector(LOCATION_PLACEHOLDER, { state: 'visible' });
  await expect(page.getByLabel('License')).toHaveText(CUSTOM);
  await page.locator('#eventRemark').fill('Survey final.');
  await editTarget(page, '2', 'Target final.');
  await saveEdit(page, rkey);

  const rows = await sql<
    { dwc_term: string; record: { body: string; license?: string } }[]
  >`SELECT dwc_term, record FROM remarks WHERE did = ${DID} ORDER BY dwc_term`;
  expect(
    rows.map((r) => [r.dwc_term, r.record.body, r.record.license]),
  ).toEqual([
    ['eventRemarks', 'Survey final.', CUSTOM],
    ['occurrenceRemarks', 'Target final.', CUSTOM],
  ]);
});

test('an over-long remark does not block saving a target set back to zero', async ({
  page,
  protocolRkey,
}) => {
  // The field is disabled once the count is gone, so an error about its
  // length would be one the surveyor cannot fix; the text is dropped anyway.
  await cacheAndOpenNewSurvey(page, HANDLE, protocolRkey);
  await targetRow(page).getByRole('button').first().click();
  await page.locator('#organism-qty').fill('5');
  // 1001 three-byte characters: under the character maxlength, over the
  // lexicon's byte limit.
  await page.locator('#occurrence-remark').fill('あ'.repeat(1001));
  await page.locator('#organism-qty').fill('0');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('#occurrence-remark')).not.toBeVisible();
  await expect(page.getByText('Remarks are too long')).not.toBeVisible();
});
