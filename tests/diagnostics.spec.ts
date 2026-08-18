import type { Page } from '@playwright/test';
import { expect, seedProtocol, teardownDid, test } from './fixtures.js';

const DID = 'did:test:diagnostics-spec';

function authCookie() {
  return {
    name: 'did',
    value: DID,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax' as const,
  };
}

// -1 means "the app has not got there yet", which keeps a poll waiting instead
// of failing. Deliberately never opens a database that does not exist: that
// would create an empty version 1, and the app's upgrade would then skip every
// store guarded by `oldVersion < 1`. Connections are closed so they cannot block
// the app's own upgrade either.
function countBreadcrumbs(page: Page) {
  return page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    if (!dbs.some((d) => d.name === 'cuanto')) return -1;
    return new Promise<number>((resolve, reject) => {
      const open = indexedDB.open('cuanto');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('diagnostics')) {
          db.close();
          resolve(-1);
          return;
        }
        const count = db
          .transaction('diagnostics', 'readonly')
          .objectStore('diagnostics')
          .count();
        count.onerror = () => {
          db.close();
          reject(count.error);
        };
        count.onsuccess = () => {
          const total = count.result;
          db.close();
          resolve(total);
        };
      };
    });
  });
}

// Records a breadcrumb the way the app really does, by firing the event the
// capture layer listens for rather than writing to IndexedDB behind its back.
// Dispatches until one lands, for two reasons: the listener does not exist until
// the app hydrates, and the write is fire-and-forget, so navigating on from an
// unconfirmed dispatch would tear the page down mid-transaction.
async function recordVisibilityBreadcrumb(page: Page) {
  await expect
    .poll(async () => {
      await page.evaluate(() =>
        document.dispatchEvent(new Event('visibilitychange')),
      );
      return countBreadcrumbs(page);
    })
    .toBeGreaterThan(0);
}

test.afterEach(async ({ sql }) => {
  await teardownDid(sql, DID);
});

test('says nothing is recorded when the log is empty', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([authCookie()]);
  await seedProtocol(sql, DID);

  await page.goto('/app/log');

  await expect(page.getByText(/nothing recorded/i)).toBeVisible();
});

test('lists breadcrumbs the app recorded', async ({ page, sql, context }) => {
  await context.addCookies([authCookie()]);
  await seedProtocol(sql, DID);
  await page.goto('/app');
  await recordVisibilityBreadcrumb(page);

  await page.goto('/app/log');

  await expect(page.getByText('visibility')).toBeVisible();
  await expect(page.getByText('visible', { exact: true })).toBeVisible();
});

test('clearing empties the log', async ({ page, sql, context }) => {
  await context.addCookies([authCookie()]);
  await seedProtocol(sql, DID);
  await page.goto('/app');
  await recordVisibilityBreadcrumb(page);
  await page.goto('/app/log');
  await expect(page.getByText('visibility')).toBeVisible();

  await page.getByRole('button', { name: 'Clear' }).click();

  await expect(page.getByText(/nothing recorded/i)).toBeVisible();
});

test('offers the log to a signed-in user from the sidebar', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([authCookie()]);
  await seedProtocol(sql, DID);

  await page.goto('/app');
  await page.getByRole('link', { name: 'Log', exact: true }).click();

  await expect(page).toHaveURL('/app/log');
});
