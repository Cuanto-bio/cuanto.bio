import type { Page } from '@playwright/test';
import { expect, seedProtocol, teardownDid, test } from '../fixtures.js';

const DID = 'did:test:protocols-spec';
const HANDLE = 'user-protocols-spec';

// ── Public protocol list routes ───────────────────────────────────────────────

test('/protocols shows protocol titles', async ({ page, sql }) => {
  await sql`INSERT INTO users (did, handle) VALUES (${DID}, ${HANDLE}) ON CONFLICT (did) DO NOTHING`;
  await seedProtocol(sql, DID);

  try {
    await page.goto('/protocols');
    await expect(
      page.getByRole('link', { name: /Test Protocol.*@user-protocols-spec/ }),
    ).toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

test('/protocols/[handle] shows protocol titles for that user', async ({
  page,
  sql,
}) => {
  await sql`INSERT INTO users (did, handle) VALUES (${DID}, ${HANDLE}) ON CONFLICT (did) DO NOTHING`;
  await seedProtocol(sql, DID);

  try {
    await page.goto(`/protocols/${HANDLE}`);
    await expect(page.getByText('Test Protocol')).toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

/**
 * Loads /protocols until the service worker controls the page and has stored
 * the page in its cache.
 */
async function cacheProtocolsPage(page: Page): Promise<void> {
  await page.goto('/protocols');
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    { timeout: 15000 },
  );
  // The first load happened before the worker took control, so only this
  // reload goes through it and lands in its cache.
  await page.reload();
  await page.waitForFunction(async () => !!(await caches.match('/protocols')), {
    timeout: 10000,
  });
}

// https://tangled.org/cuanto.bio/cuanto.bio/issues/88: the service worker
// caches /protocols for offline use. Serving that cached copy while online
// meant a protocol created since the last visit didn't appear until a refresh.
test('/protocols shows a protocol added since the service worker cached it', async ({
  page,
  sql,
}) => {
  await sql`INSERT INTO users (did, handle) VALUES (${DID}, ${HANDLE}) ON CONFLICT (did) DO NOTHING`;

  try {
    await cacheProtocolsPage(page);

    await seedProtocol(sql, DID, 'Protocol Added After Caching');

    await page.goto('/protocols');
    await expect(
      page.getByRole('link', { name: /Protocol Added After Caching/ }),
    ).toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

// A server that's down behind a proxy answers with a 5xx instead of refusing
// the connection. The cached copy is more useful than the proxy's error page.
test('/protocols falls back to the cached copy when the server errors', async ({
  page,
  context,
  sql,
}) => {
  await sql`INSERT INTO users (did, handle) VALUES (${DID}, ${HANDLE}) ON CONFLICT (did) DO NOTHING`;
  await seedProtocol(sql, DID, 'Cached Protocol');

  try {
    await cacheProtocolsPage(page);
    await context.route('**/protocols', (route) =>
      route.fulfill({ status: 502, body: 'Bad Gateway' }),
    );

    await page.goto('/protocols');
    await expect(
      page.getByRole('link', { name: /Cached Protocol/ }),
    ).toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

// A server that's down behind a proxy can also just hang
// (https://tangled.org/cuanto.bio/cuanto.bio/issues/83). Waiting on the
// network with a cached copy in hand leaves the page stuck until the browser
// gives up on the request.
test('/protocols falls back to the cached copy when the server hangs', async ({
  page,
  context,
  sql,
}) => {
  await sql`INSERT INTO users (did, handle) VALUES (${DID}, ${HANDLE}) ON CONFLICT (did) DO NOTHING`;
  await seedProtocol(sql, DID, 'Cached Protocol');

  try {
    await cacheProtocolsPage(page);
    // Never answered, like a request to a server that hangs.
    await context.route('**/protocols', () => {});

    await page.goto('/protocols', { timeout: 10000 });
    await expect(
      page.getByRole('link', { name: /Cached Protocol/ }),
    ).toBeVisible();
  } finally {
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await teardownDid(sql, DID);
  }
});
