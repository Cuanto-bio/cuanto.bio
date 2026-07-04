import { expect, test } from '../fixtures.js';
import { cacheAndOpenNewSurvey } from './helpers.js';

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

  test('filters taxon targets by scientificName with trailing space', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.getByPlaceholder('Search targets…').fill('agrifolia ');
    await expect(
      page.getByText('Coast live oak (Quercus agrifolia)'),
    ).toBeVisible();
    await expect(page.getByText('All birds')).not.toBeVisible();
  });

  test('filters taxon targets by vernacularName regardless of punctuation', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.getByPlaceholder('Search targets…').fill('fishers');
    await expect(
      page.getByText("Fisher's Aeolid (Orienthella piunca)"),
    ).toBeVisible();
    await expect(page.getByText('All birds')).not.toBeVisible();
  });

  test('filters taxon targets by vernacularName regardless of punctuation in query', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.getByPlaceholder('Search targets…').fill('fishers-aeolid');
    await expect(
      page.getByText("Fisher's Aeolid (Orienthella piunca)"),
    ).toBeVisible();
    await expect(page.getByText('All birds')).not.toBeVisible();
  });
});

// ── Target sort and filter dropdown ───────────────────────────────────────────

test.describe('target sort and filter dropdown', () => {
  // The fixture seeds two targets in this order:
  //   [0] taxon: Quercus agrifolia / Coast live oak
  //   [1] verbatim: All birds
  // Both scientific and common sorts should put "All birds" first (A < C and A < Q).

  async function openDropdown(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Sort' }).click();
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

  test('"Only counted" hides targets with zero count', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.locator('[aria-label="Increase count"]').nth(0).click();
    await page.getByRole('button', { name: 'Only counted' }).click();
    await expect(page.getByText('Coast live oak')).toBeVisible();
    await expect(page.getByText('All birds')).not.toBeVisible();
  });

  test('tapping "Only counted" with nothing counted shows a toast', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page
      .getByRole('button', { name: /Only counted/ })
      .click({ force: true });
    await expect(
      page.getByText('Count a target to only show counted'),
    ).toBeVisible();
  });

  test('activating "Only counted" clears the search query', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.locator('[aria-label="Increase count"]').nth(0).click();
    await page.getByPlaceholder('Search targets…').fill('coast');
    await page.getByRole('button', { name: /Only counted/ }).click();
    await expect(page.getByPlaceholder('Search targets…')).toHaveValue('');
  });

  test('focusing the search input deactivates "Only counted"', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.locator('[aria-label="Increase count"]').nth(0).click();
    await page.getByRole('button', { name: /Only counted/ }).click();
    await expect(page.getByText('All birds')).not.toBeVisible();
    await page.getByPlaceholder('Search targets…').click();
    await expect(page.getByText('All birds')).toBeVisible();
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

// ── Target flash on search clear ──────────────────────────────────────────────

test('clearing a search does not flash counted targets', async ({
  page,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

  // Increment "All birds" once
  const allBirdsItem = page.locator('li').filter({ hasText: 'All birds' });
  await allBirdsItem.getByRole('button', { name: 'Increase count' }).click();

  // Search for "oak" to hide "All birds" from the list
  const searchInput = page.getByPlaceholder('Search targets…');
  await searchInput.fill('oak');
  await expect(allBirdsItem).not.toBeVisible();

  // Clear the search — "All birds" remounts
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(allBirdsItem).toBeVisible();

  // The remounted li should NOT have the flash class
  const hasFlash = await allBirdsItem.evaluate((el) =>
    el.classList.contains('li-flash'),
  );
  expect(hasFlash).toBe(false);
});
