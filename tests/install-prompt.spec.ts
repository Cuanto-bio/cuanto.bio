import { devices } from '@playwright/test';
import { expect, seedProtocol, teardownDid, test } from './fixtures.js';

const iPhone = devices['iPhone 15'];

const IOS_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36';

const FOOTER = { role: 'button' as const, name: 'Install Cuanto as an app' };

test.describe('footer entry point', () => {
  test.describe('on a touch device', () => {
    test.use({ viewport: iPhone.viewport, hasTouch: true, isMobile: true });

    test('shows the install footer', async ({ page }) => {
      await page.goto('/');
      await expect(
        page.getByRole(FOOTER.role, { name: FOOTER.name }),
      ).toBeVisible();
    });
  });

  test.describe('on desktop (no touch)', () => {
    test.use({
      viewport: { width: 1280, height: 800 },
      hasTouch: false,
      isMobile: false,
    });

    test('hides the install footer', async ({ page }) => {
      await page.goto('/');
      await expect(
        page.getByRole(FOOTER.role, { name: FOOTER.name }),
      ).toHaveCount(0);
    });
  });

  test.describe('when already running standalone', () => {
    test.use({ viewport: iPhone.viewport, hasTouch: true, isMobile: true });

    test('hides the install footer', async ({ page }) => {
      // Emulate an installed PWA by forcing the display-mode:standalone query.
      await page.addInitScript(() => {
        const orig = window.matchMedia.bind(window);
        window.matchMedia = (query: string) => {
          if (query.includes('display-mode: standalone')) {
            return {
              matches: true,
              media: query,
              onchange: null,
              addEventListener() {},
              removeEventListener() {},
              addListener() {},
              removeListener() {},
              dispatchEvent() {
                return false;
              },
            } as unknown as MediaQueryList;
          }
          return orig(query);
        };
      });
      await page.goto('/');
      await expect(
        page.getByRole(FOOTER.role, { name: FOOTER.name }),
      ).toHaveCount(0);
    });
  });
});

test.describe('install dialog instructions', () => {
  test.describe('iOS Safari', () => {
    test.use({
      viewport: iPhone.viewport,
      hasTouch: true,
      isMobile: true,
      userAgent: IOS_SAFARI_UA,
    });

    test('shows Add to Home Screen steps and no bookmark/Install', async ({
      page,
    }) => {
      await page.goto('/');
      await page.getByRole(FOOTER.role, { name: FOOTER.name }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByText('Use Cuanto offline in the field'),
      ).toBeVisible();
      await expect(dialog.getByText(/Add to Home Screen/)).toBeVisible();
      // We never offer a one-click button; Chrome owns the native install
      // prompt and our dialog only shows manual instructions.
      await expect(
        dialog.getByRole('button', { name: 'Install', exact: true }),
      ).toHaveCount(0);
      // No bookmark alternative on iOS (storage is evicted after ~7 days).
      await expect(dialog.getByText(/bookmark this page/)).toHaveCount(0);
    });
  });

  test.describe('Android Chrome', () => {
    test.use({
      viewport: iPhone.viewport,
      hasTouch: true,
      isMobile: true,
      userAgent: ANDROID_CHROME_UA,
    });

    test('shows the bookmark alternative off iOS', async ({ page }) => {
      await page.goto('/');
      await page.getByRole(FOOTER.role, { name: FOOTER.name }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(/bookmark this page/)).toBeVisible();
    });
  });
});

test.describe('auto-prompt after following a protocol', () => {
  const DID = 'did:test:install-auto';
  const HANDLE = 'user-install-auto';

  test.use({ viewport: iPhone.viewport, hasTouch: true, isMobile: true });

  test('auto-shows once, then is suppressed after dismissal', async ({
    page,
    sql,
    context,
  }) => {
    await teardownDid(sql, DID);
    await context.addCookies([
      {
        name: 'did',
        value: DID,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const { protocolRkey } = await seedProtocol(sql, DID);

    try {
      await page.goto(`/protocols/${HANDLE}/${protocolRkey}`);

      // Follow → dialog auto-appears.
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByRole('button', { name: 'Follow this protocol' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // Closing the auto-shown dialog records a dismissal.
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);

      // Unfollow then follow again — no auto-prompt this time.
      await page.getByRole('button', { name: 'Unfollow' }).click();
      await page.getByRole('button', { name: 'Follow this protocol' }).click();
      await expect(
        page.getByRole('button', { name: 'Unfollow' }),
      ).toBeVisible();
      await expect(dialog).toHaveCount(0);

      // The footer button still opens it manually.
      await page
        .getByRole('button', { name: 'Install Cuanto as an app' })
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
    } finally {
      await teardownDid(sql, DID);
    }
  });
});
