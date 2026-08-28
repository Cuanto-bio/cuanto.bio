import { devices } from '@playwright/test';
import { expect, test } from '../fixtures.js';
import { cacheAndOpenNewSurvey, seedExtraTargets } from './helpers.js';

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

  test('sort and "Only counted" survive leaving and resuming the survey', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    // Count "All birds" so "Only counted" is enabled, then turn it on.
    await page
      .locator('li')
      .filter({ hasText: 'All birds' })
      .getByRole('button', { name: 'Increase count' })
      .click();
    await openDropdown(page);
    await page.getByRole('menuitemradio', { name: 'Scientific name' }).click();
    await page.getByRole('button', { name: /Only counted/ }).click();
    await expect(page.getByText('Coast live oak')).not.toBeVisible();

    // Leave the survey (auto-saves the draft) and resume it.
    await page.getByRole('link', { name: 'Your Surveys' }).click();
    await page.waitForURL(/\/app\/surveys$/);
    await page.getByRole('link', { name: 'Resume', exact: true }).click();
    await page.waitForSelector('text=Finish Survey', { state: 'visible' });

    await expect(
      page.getByRole('button', { name: /Only counted/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Coast live oak')).not.toBeVisible();
    await openDropdown(page);
    await expect(
      page.getByRole('menuitemradio', { name: 'Scientific name' }),
    ).toBeChecked();
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

// ── Search bar pins to the top on focus ───────────────────────────────────────

test.describe('target search focus scroll', () => {
  const { viewport, hasTouch, isMobile } = devices['iPhone 15'];
  test.use({ viewport, hasTouch, isMobile });

  // Distance from the filter bar's top edge to the top of the scroll area.
  const gapToTop = (page: import('@playwright/test').Page) =>
    page.getByPlaceholder('Search targets…').evaluate((input) => {
      const bar = input.closest('.sticky');
      const scroller = input.closest('.mobile-scroll');
      if (!bar || !scroller) return Number.NaN;
      return Math.round(
        bar.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
      );
    });

  test('focusing the search input pins the filter bar to the top', async ({
    page,
    sql,
    protocolRkey,
  }) => {
    await seedExtraTargets(sql, 'did:test:survey-spec', protocolRkey, 30);
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

    // Reset to the top so the bar sits well below the viewport top.
    await page.locator('.mobile-scroll').evaluate((el) => {
      el.scrollTop = 0;
    });
    expect(await gapToTop(page)).toBeGreaterThan(40);

    await page.getByPlaceholder('Search targets…').focus();

    // The bar pins to the top of the scroll area, and only that box scrolls:
    // the document must not move (on iOS Safari that would carry the header off
    // the top of the screen), and the field must stay visible near the top.
    await expect.poll(() => gapToTop(page)).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const fieldTop = await page
      .getByPlaceholder('Search targets…')
      .evaluate((el) => Math.round(el.getBoundingClientRect().top));
    expect(fieldTop).toBeGreaterThanOrEqual(0);
    expect(fieldTop).toBeLessThan(120);
  });

  test('the pin happens synchronously, within the focus event', async ({
    page,
    sql,
    protocolRkey,
  }) => {
    await seedExtraTargets(sql, 'did:test:survey-spec', protocolRkey, 30);
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

    // A pin deferred to rAF lands after the browser's own scroll-into-view for
    // the focused element, so iOS scrolls by the distance it measured before
    // the pin and the pin then scrolls again, carrying the field off the top.
    // Focus and measure in one task: only a synchronous pin shows up here.
    const { gapBefore, scrollTopAfter } = await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>(
        'input[placeholder="Search targets…"]',
      );
      const bar = input?.closest('.sticky');
      const scroller = input?.closest('.mobile-scroll') as HTMLElement | null;
      if (!input || !bar || !scroller) {
        return { gapBefore: Number.NaN, scrollTopAfter: Number.NaN };
      }
      scroller.scrollTop = 0;
      const gapBefore = Math.round(
        bar.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
      );
      input.focus();
      return { gapBefore, scrollTopAfter: Math.round(scroller.scrollTop) };
    });

    expect(gapBefore).toBeGreaterThan(40);
    expect(scrollTopAfter).toBe(gapBefore);
  });

  test('stays pinned when a search narrows the list to a few rows', async ({
    page,
    sql,
    protocolRkey,
  }) => {
    await seedExtraTargets(sql, 'did:test:survey-spec', protocolRkey, 30);
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

    const search = page.getByPlaceholder('Search targets…');
    await search.focus();
    await expect.poll(() => gapToTop(page)).toBeLessThanOrEqual(2);

    // Filtering shrinks the list, and with it the scrollable height. Without
    // room to stay scrolled this far the browser clamps scrollTop back, which
    // drags the bar down the screen just as the results appear under it.
    await search.fill('agrifolia');
    await expect(
      page.getByText('Coast live oak (Quercus agrifolia)'),
    ).toBeVisible();

    expect(await gapToTop(page)).toBeLessThanOrEqual(2);
  });

  test('pins the bar when focusing the search clears "Only counted"', async ({
    page,
    sql,
    protocolRkey,
  }) => {
    await seedExtraTargets(sql, 'did:test:survey-spec', protocolRkey, 30);
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

    // Narrow the list to the one counted target, so the scrollable height is
    // far shorter than the distance the pin is about to scroll.
    await page.locator('[aria-label="Increase count"]').nth(0).click();
    await page.getByRole('button', { name: /Only counted/ }).click();
    await page.locator('.mobile-scroll').evaluate((el) => {
      el.scrollTop = 0;
    });

    // Focus clears "Only counted" as well as pinning. The list it re-expands to
    // is the height the pin needs, so the two have to happen in that order
    // rather than both against the short list.
    await page.getByPlaceholder('Search targets…').focus();

    await expect.poll(() => gapToTop(page)).toBeLessThanOrEqual(2);
  });

  test('keeps the incidentals prompt in view when a search finds nothing', async ({
    page,
    sql,
    protocolRkey,
  }) => {
    await seedExtraTargets(sql, 'did:test:survey-spec', protocolRkey, 30);
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

    const search = page.getByPlaceholder('Search targets…');
    await search.focus();
    await search.fill('zzznomatch');
    await expect(page.getByText(/No targets match/)).toBeVisible();

    // Searching for a target that is not in the protocol is exactly when
    // someone needs to be told they can record it as an incidental, so the
    // padding that holds the filter bar up must not push that offer offscreen.
    await expect(
      page.getByRole('button', { name: 'Add incidental' }),
    ).toBeInViewport();
    expect(await gapToTop(page)).toBeLessThanOrEqual(2);
  });
});

test.describe('target search focus scroll (desktop)', () => {
  // On desktop there is no on-screen keyboard, so focusing the field must not
  // make the page jump to pin the filter bar.
  test('focusing the search input does not scroll the page', async ({
    page,
    sql,
    protocolRkey,
  }) => {
    await seedExtraTargets(sql, 'did:test:survey-spec', protocolRkey, 30);
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

    const search = page.getByPlaceholder('Search targets…');
    await search.scrollIntoViewIfNeeded();
    // Nudge so the field sits well below the top of the viewport.
    await page.evaluate(() => window.scrollBy(0, -100));
    const topBefore = await search.evaluate((el) =>
      Math.round(el.getBoundingClientRect().top),
    );
    expect(topBefore).toBeGreaterThan(40);

    await search.focus();
    await page.waitForTimeout(200);

    const topAfter = await search.evaluate((el) =>
      Math.round(el.getBoundingClientRect().top),
    );
    expect(Math.abs(topAfter - topBefore)).toBeLessThan(20);
  });
});
