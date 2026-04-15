import { expect, seedProtocol, teardownDid, test } from './fixtures.js';

test('can create a survey and see it in the surveys list', async ({
  page,
  protocolRkey,
}) => {
  await page.goto(`/surveys/new/${protocolRkey}`);

  await page.waitForFunction(
    () =>
      (document.querySelector('input[name="eventDate"]') as HTMLInputElement)
        ?.value !== '',
  );

  await page.fill('[name="locationName"]', 'Integration Test Park');
  await page.locator('[aria-label="Increase count"]').first().click();
  await page.locator('[aria-label="Increase count"]').first().click();
  await page.click('button[type="submit"]');

  await expect(page).toHaveURL(/\/surveys\/user-survey-spec\/test\d+/);
  await expect(page.getByText('Integration Test Park')).toBeVisible();
});

test('survey detail page shows occurrences', async ({ page, protocolRkey }) => {
  await page.goto(`/surveys/new/${protocolRkey}`);

  await page.waitForFunction(
    () =>
      (document.querySelector('input[name="eventDate"]') as HTMLInputElement)
        ?.value !== '',
  );

  await page.fill('[name="locationName"]', 'Detail Test Site');
  await page.locator('[aria-label="Increase count"]').nth(1).click();
  await page.click('button[type="submit"]');

  await expect(page).toHaveURL(/\/surveys\/user-survey-spec\/test\d+/);
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

  await page.goto(`/surveys/new/${protocolRkey}`);

  await page.waitForFunction(
    () =>
      (document.querySelector('input[name="eventDate"]') as HTMLInputElement)
        ?.value !== '',
  );

  await page.fill('[name="locationName"]', 'Cross-user Survey');
  await page.locator('[aria-label="Increase count"]').first().click();
  await page.click('button[type="submit"]');

  await expect(page).toHaveURL(
    /\/surveys\/user-survey-spec-other-user\/test\d+/,
  );
  await expect(page.getByText('Cross-user Survey')).toBeVisible();

  await teardownDid(sql, otherDid);
});
