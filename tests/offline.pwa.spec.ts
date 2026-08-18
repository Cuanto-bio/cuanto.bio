import { createHash, randomBytes } from 'node:crypto';
import { test as base, devices, expect } from '@playwright/test';
import postgres, { type Sql } from 'postgres';
import { seedProtocol, teardownDid } from './fixtures.js';
import { installNativeBridge } from './nativeBridge.js';

const TEST_DB_URL = 'postgresql://cuanto:cuanto@localhost:5432/cuanto_test';

const AUTH_COOKIE = {
  name: 'did',
  value: 'did:test:offline-pwa',
  domain: '127.0.0.1',
  path: '/',
  httpOnly: true,
  sameSite: 'Lax' as const,
};

type Fixtures = { sql: Sql };

const test = base.extend<Fixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires destructuring here
  sql: async ({}, use) => {
    const connection = postgres(TEST_DB_URL, { max: 1 });
    await use(connection);
    await connection.end();
  },
});

test('app shell loads offline at an unvisited /app/* route', async ({
  page,
  context,
}) => {
  // Set a fake auth cookie so the /app/ layout does not redirect to /auth/signin.
  // PDS_MOCK mode accepts any did value. Domain must match the preview server's
  // host (127.0.0.1, not localhost).
  await context.addCookies([AUTH_COOKIE]);

  // Navigate to /app/protocols (not /app/ — avoids the server's trailing-slash
  // redirect and SvelteKit's client-side redirect to /app/protocols). The SW
  // installs during this visit and caches the /app/ shell plus all JS assets,
  // making every /app/* URL servable offline.
  await page.goto('/app/protocols');

  // Wait until the SW is controlling the page. A first activation does NOT
  // reload the page: the layout only reloads when an update replaces a worker
  // that was already controlling it (reloadOnControllerChange, issue #42).
  // 15 s: SW install runs cacheAssets() which fetches the shell + ~50 hashed
  // assets before the SW can activate, so first-activation is slower than usual.
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    {
      timeout: 15000,
    },
  );
  // Let the install's asset fetching settle before evaluating anything.
  await page.waitForLoadState('networkidle', { timeout: 10000 });

  // Confirm the SW cached the /app/ shell during install before trusting the
  // offline behavior. If this fails, the rest of the test would be a false
  // negative.
  const shellCached = await page.evaluate(async () => {
    const keys = await caches.keys();
    for (const key of keys) {
      const cache = await caches.open(key);
      if (await cache.match('/app/')) return true;
    }
    return false;
  });
  expect(shellCached).toBe(true);

  // Cut the network. context.setOffline blocks outgoing connections; the SW
  // still responds from its Cache API store, which is independent of the
  // network layer.
  await context.setOffline(true);

  // Hard-navigate to a route never visited in this session. The SW's fetch
  // handler matches any navigate request to /app/* and responds with the
  // cached /app/ shell — no server access needed.
  const response = await page.goto('/app/surveys');

  // HTTP 200 proves the SW served the cached shell rather than a browser
  // network error page (which would throw or return a non-200 status).
  expect(response?.status()).toBe(200);

  // Wait for SvelteKit to mount and onMount effects to run (sets isOnline from
  // navigator.onLine). networkidle is more reliable than relying solely on
  // Playwright's implicit assertion retry here.
  await page.waitForLoadState('networkidle', { timeout: 10000 });
  // The root layout's onMount sets isOnline from navigator.onLine. The banner
  // being visible confirms the shell was served and SvelteKit's JS executed.
  await expect(page.getByText("You're offline")).toBeVisible();
});

// The reported platform: the Android wrapper, on a narrow coarse-pointer
// viewport, authenticating with a bearer token because the app-bound webview
// never receives the `did` cookie. Both matter — the mobile nav only renders at
// that viewport, and the missing cookie is why the cached user is the only
// thing that can keep the nav signed in when a load fails.
const { viewport, hasTouch, isMobile } = devices['iPhone 15'];

const NATIVE_DID = 'did:test:offline-pwa-native';

/** Mints a live bearer token the way /api/auth/token does, without the flow. */
async function seedToken(sql: Sql, did: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  await sql`
    INSERT INTO app_tokens (token_hash, did, label, expires_at)
    VALUES (${hash}, ${did}, 'offline-pwa-spec', ${new Date(Date.now() + 3600_000)})
  `;
  return token;
}

test.describe('offline navigation to a route the service worker does not cache', () => {
  test.use({ viewport, hasTouch, isMobile });

  // https://tangled.org/cuanto.bio/cuanto.bio/issues/54
  test('explains the connection and keeps the signed-in nav', async ({
    page,
    context,
    sql,
  }) => {
    await seedProtocol(sql, NATIVE_DID);
    const token = await seedToken(sql, NATIVE_DID);
    await installNativeBridge(page);
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      ['cuanto:native-token', token],
    );

    try {
      // No cookie, deliberately: the wrapper has none. /api/me answers from the
      // bearer token, and /app/+layout.ts writes the user to IndexedDB.
      await page.goto('/app/protocols/following');
      await page.waitForFunction(
        () => navigator.serviceWorker.controller !== null,
        { timeout: 15000 },
      );
      await page.waitForLoadState('networkidle', { timeout: 10000 });
      // Signed in, with the wrapper's own tabs showing. Without this the
      // offline assertions below could pass for the wrong reason.
      await expect(
        page.getByRole('link', { name: 'Your Surveys' }),
      ).toBeVisible();

      await context.setOffline(true);

      // Client-side navigation, the way the report describes it: Explore →
      // All Surveys. /surveys is server-rendered and the service worker caches
      // nothing for it, so its __data.json fetch fails and the load throws.
      await page.getByRole('button', { name: 'Explore' }).click();
      await page.getByRole('menuitem', { name: 'All Surveys' }).click();
      await expect(page).toHaveURL(/\/surveys$/);

      await expect(page.locator('[data-slot="card-title"]')).toHaveText(
        "You're offline",
      );
      await expect(
        page.locator('[data-slot="card-description"]'),
      ).toContainText(/connection/i);
      // "Go home" has to land somewhere the service worker actually serves.
      await expect(page.getByRole('link', { name: 'Go home' })).toHaveAttribute(
        'href',
        '/app',
      );

      // Retrying while still offline has to re-run the load in place. A hard
      // reload would leave the service worker with nothing to serve for
      // /surveys, dropping the user onto the webview's own network error page
      // and out of the app entirely.
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(page).toHaveURL(/\/surveys$/);
      await expect(page.locator('[data-slot="card-title"]')).toHaveText(
        "You're offline",
      );

      // The nav must not drop to the signed-out tabs while the user is signed
      // in. SvelteKit keeps the previous page's data through a failed
      // navigation, so this holds today via that route as well as via the root
      // layout's cache fallback — it is pinned here because losing either one
      // puts "Sign in" back in front of a signed-in surveyor.
      await expect(
        page.getByRole('link', { name: 'Your Surveys' }),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
    } finally {
      await context.setOffline(false);
      await sql`DELETE FROM app_tokens WHERE did = ${NATIVE_DID}`;
      await teardownDid(sql, NATIVE_DID);
    }
  });
});
