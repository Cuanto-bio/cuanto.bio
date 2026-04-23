import { expect, seedProtocol, teardownDid, test } from './fixtures.js';

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
      domain: 'localhost',
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
