import { expect, test } from '@playwright/test';

const AUTH_COOKIE = {
  name: 'did',
  value: 'did:test:offline-pwa',
  domain: '127.0.0.1',
  path: '/',
  httpOnly: true,
  sameSite: 'Lax' as const,
};

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

  // Wait until the SW is controlling the page. The layout fires
  // window.location.reload() on controllerchange (first SW activation); then
  // waitForFunction re-evaluates in the reloaded page context.
  // 15 s: SW install runs cacheAssets() which fetches the shell + ~50 hashed
  // assets before the SW can activate, so first-activation is slower than usual.
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    {
      timeout: 15000,
    },
  );
  // Wait for the reload triggered by controllerchange to fully settle before
  // evaluating anything.
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
