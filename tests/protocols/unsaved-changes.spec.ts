import { devices, type Page } from '@playwright/test';
import { expect, seedProtocol, teardownDid, test } from '../fixtures.js';

const iPhone = devices['iPhone 15'];

const DID = 'did:test:protocol-unsaved';

function authCookie(did: string) {
  return {
    name: 'did',
    value: did,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax' as const,
  };
}

// A viewport short enough that the protocol form overflows it, so a save button
// pinned to the bottom of the screen is distinguishable from one that simply
// sits at the end of a short page.
const SHORT_VIEWPORT = { width: 1024, height: 400 };

// The unsaved-changes guard only exists once the client has hydrated. Clicking a
// nav link before then does a plain browser navigation, which would sail past the
// guard and make these tests pass for the wrong reason.
async function openNewProtocolForm(page: Page) {
  await page.goto('/protocols/new');
  await page.waitForLoadState('networkidle');
  await expect(page.getByLabel('Title')).toBeVisible();
}

test.describe('protocol form save button', () => {
  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, DID);
  });

  test('stays on screen without scrolling on the new protocol form', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(DID)]);
    await seedProtocol(sql, DID);
    await page.setViewportSize(SHORT_VIEWPORT);
    await page.goto('/protocols/new');

    const save = page.getByRole('button', { name: 'Create protocol' });
    await expect(save).toBeInViewport();
  });

  test('stays on screen after scrolling the new protocol form', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(DID)]);
    await seedProtocol(sql, DID);
    await page.setViewportSize(SHORT_VIEWPORT);
    await page.goto('/protocols/new');

    await page.mouse.wheel(0, 600);
    const save = page.getByRole('button', { name: 'Create protocol' });
    await expect(save).toBeInViewport();
  });

  // On narrow/touch viewports .mobile-scroll is the scroller rather than the
  // document, so the bar pins to a different container. It must land above the
  // mobile nav either way.
  test.describe('on a touch device', () => {
    test.use({ viewport: iPhone.viewport, hasTouch: true, isMobile: true });

    test('stays on screen after scrolling the new protocol form', async ({
      page,
      sql,
      context,
    }) => {
      await context.addCookies([authCookie(DID)]);
      await seedProtocol(sql, DID);
      await page.goto('/protocols/new');

      await page
        .locator('.mobile-scroll')
        .evaluate((el) => el.scrollTo(0, 400));

      const save = page.getByRole('button', { name: 'Create protocol' });
      await expect(save).toBeInViewport();
    });
  });
});

test.describe('protocol form unsaved changes', () => {
  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, DID);
  });

  test('navigating away with no edits does not prompt', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(DID)]);
    await seedProtocol(sql, DID);
    await openNewProtocolForm(page);

    await page.getByRole('link', { name: 'Protocols', exact: true }).click();
    await page.waitForURL(/\/protocols$/);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('navigating away with edits prompts and staying keeps the entries', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(DID)]);
    await seedProtocol(sql, DID);
    await openNewProtocolForm(page);

    await page.getByLabel('Title').fill('Half-written protocol');
    await page.getByRole('link', { name: 'Protocols', exact: true }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep editing' }).click();

    await expect(page).toHaveURL(/\/protocols\/new$/);
    await expect(page.getByLabel('Title')).toHaveValue('Half-written protocol');
  });

  test('navigating away with edits prompts and discarding leaves', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(DID)]);
    await seedProtocol(sql, DID);
    await openNewProtocolForm(page);

    await page.getByLabel('Title').fill('Half-written protocol');
    await page.getByRole('link', { name: 'Protocols', exact: true }).click();

    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Discard changes' })
      .click();

    await page.waitForURL(/\/protocols$/);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('reverting an edit by hand clears the prompt', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(DID)]);
    await seedProtocol(sql, DID);
    await openNewProtocolForm(page);

    await page.getByLabel('Title').fill('Typed then erased');
    await page.getByLabel('Title').fill('');

    await page.getByRole('link', { name: 'Protocols', exact: true }).click();
    await page.waitForURL(/\/protocols$/);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('saving the form navigates without prompting', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(DID)]);
    await seedProtocol(sql, DID);
    await openNewProtocolForm(page);

    await page.getByLabel('Title').fill('Saved protocol');
    await page.getByLabel('Description').fill('A protocol that gets saved.');
    await page.getByRole('button', { name: 'Create protocol' }).click();

    await page.waitForURL(/\/protocols\/[^/]+\/[^/]+$/);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });
});
