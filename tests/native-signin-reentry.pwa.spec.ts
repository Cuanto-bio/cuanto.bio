import { createHash, randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test as base, expect } from '@playwright/test';
import type { Sql } from 'postgres';
import postgres from 'postgres';
import { teardownDid } from './fixtures.js';
import {
  fireAppUrlOpen,
  installNativeBridge,
  readCapCalls,
} from './nativeBridge.js';

// Reproduces: sign out, then sign in as a *different* user without quitting
// the app, and the wrapper is left stranded on /app/signin — nav tabs dead,
// "Sign in" reopens the system browser — while the token is already stored
// and /api/me answers for the new user. A force-quit shows them signed in.

const TEST_DB_URL = 'postgresql://cuanto:cuanto@localhost:5432/cuanto_test';

const test = base.extend<{ sql: Sql }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires destructuring here
  sql: async ({}, use) => {
    const connection = postgres(TEST_DB_URL, { max: 1 });
    await use(connection);
    await connection.end();
  },
});

const A_DID = 'did:test:reentry-a';
const B_DID = 'did:test:reentry-b';

function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

async function browserOpenUrl(page: Page): Promise<string> {
  const calls = await readCapCalls(page);
  const opens = calls.filter(
    (c) => c.pluginName === 'Browser' && c.methodName === 'open',
  );
  return opens.at(-1)?.options?.url ?? '';
}

/** Drives the whole system-browser handoff for `did`, as the app does. */
async function completeSignIn(page: Page, sql: Sql, did: string) {
  const before = await browserOpenUrl(page);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect.poll(async () => browserOpenUrl(page)).not.toBe(before);

  const challenge = new URL(await browserOpenUrl(page)).searchParams.get(
    'challenge',
  );
  expect(challenge).toBeTruthy();

  const code = randomBytes(32).toString('base64url');
  await sql`
    INSERT INTO app_token_codes (code_hash, did, challenge, expires_at)
    VALUES (${sha256hex(code)}, ${did}, ${challenge},
            ${new Date(Date.now() + 60_000)})
  `;
  await fireAppUrlOpen(page, `bio.cuanto.app://auth?code=${code}`);
}

test.describe('native sign-in re-entry', () => {
  test.beforeEach(async ({ sql }) => {
    for (const did of [A_DID, B_DID]) {
      const handle = `user-${did.split(':').pop()}`;
      await sql`
        INSERT INTO users (did, handle) VALUES (${did}, ${handle})
        ON CONFLICT (did) DO NOTHING
      `;
    }
  });

  test.afterEach(async ({ sql }) => {
    for (const did of [A_DID, B_DID]) {
      await sql`DELETE FROM app_token_codes WHERE did = ${did}`;
      await sql`DELETE FROM app_tokens WHERE did = ${did}`;
      await teardownDid(sql, did);
    }
  });

  test('signing in as a second user lands in the app, not stuck on signin', async ({
    page,
    sql,
  }) => {
    await installNativeBridge(page);
    await page.goto('/app/signin');
    await completeSignIn(page, sql, A_DID);
    await expect(page).toHaveURL(/\/app\/protocols\/following/, {
      timeout: 15_000,
    });
    // The whole point of running this under the PWA config: wait until the
    // service worker actually controls the page, so the sign-out navigation
    // below is served the cached /app/ shell the way the wrapper is.
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
      { timeout: 20_000 },
    );

    // Sign out the way the UI does: clearIdb + revoke + full page load back
    // to /app/signin. No force-quit, so the JS context is only as fresh as
    // that navigation makes it.
    await page.goto('/app/account');
    await page
      .getByRole('main')
      .getByRole('button', { name: /sign out/i })
      .click();
    await expect(page).toHaveURL(/\/app\/signin/, { timeout: 15_000 });

    await completeSignIn(page, sql, B_DID);

    await expect(page).toHaveURL(/\/app\/protocols\/following/, {
      timeout: 15_000,
    });
  });
});
