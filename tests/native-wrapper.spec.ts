import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from './fixtures.js';
import {
  fireAppUrlOpen,
  installNativeBridge,
  readCapCalls,
} from './nativeBridge.js';

// End-to-end coverage of the native wrapper's isNative()-gated web code, driven
// through a browser with a faked Capacitor bridge (tests/nativeBridge.ts). This
// runs the real native.ts / platform.ts / app-layout guard / bearer fetch
// wrapper unchanged; only the OS boundary (system browser, deep link) is faked.
// The parts that genuinely need a device are covered by the Layer 3 checklist,
// not here.

const DID = 'did:test:native-wrapper';
const HANDLE = 'user-native-wrapper';

function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

async function browserOpenUrl(page: Parameters<typeof readCapCalls>[0]) {
  const open = (await readCapCalls(page)).find(
    (c) => c.pluginName === 'Browser' && c.methodName === 'open',
  );
  return open?.options?.url ?? '';
}

test.describe('native wrapper sign-in flow', () => {
  test.afterEach(async ({ sql }) => {
    await sql`DELETE FROM app_token_codes WHERE did = ${DID}`;
    await sql`DELETE FROM app_tokens WHERE did = ${DID}`;
    await sql`DELETE FROM users WHERE did = ${DID}`;
  });

  test('shows home content at /app for a signed-out user instead of forcing sign-in', async ({
    page,
  }) => {
    await installNativeBridge(page);
    await page.goto('/app');
    // /api/me is unauthenticated (no token, no cookie). /app is the wrapper's
    // launch target (capacitor.config.ts) and the only route the service
    // worker caches for offline launch (service-worker.ts), so a signed-out
    // visit renders the same content as `/` in place rather than redirecting
    // to /app/signin — sign-in stays reachable from the nav (see nav-tabs.ts,
    // sidebar.svelte).
    await expect(page).toHaveURL(/\/app$/);
    await expect(
      page.getByRole('link', { name: /start counting/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /sign in to cuanto/i }),
    ).toHaveCount(0);
  });

  test('shows the native sign-in UI, not the web form', async ({ page }) => {
    await installNativeBridge(page);
    await page.goto('/app/signin');
    await expect(
      page.getByRole('heading', { name: /sign in to cuanto/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /^sign in$/i }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/app\/signin/);
  });

  test('a web (non-native) visitor to /app/signin is sent to the web form', async ({
    page,
  }) => {
    // No bridge: isNative() is false, so the native-only route must not render
    // its UI to a browser user; it redirects to the server-rendered form.
    await page.goto('/app/signin');
    await expect(page).toHaveURL(/\/auth\/signin/);
  });

  test('starting sign-in opens the system browser with a PKCE challenge', async ({
    page,
  }) => {
    await installNativeBridge(page);
    await page.goto('/app/signin');
    await page.getByRole('button', { name: /^sign in$/i }).click();

    await expect
      .poll(async () => browserOpenUrl(page))
      .toContain('/auth/signin?client=native&challenge=');
    const url = await browserOpenUrl(page);
    // A 43-char base64url challenge is SHA-256(verifier) with no padding.
    expect(new URL(url).searchParams.get('challenge')).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
  });

  test('completing the deep-link callback signs the user in', async ({
    page,
    sql,
  }) => {
    await sql`
      INSERT INTO users (did, handle) VALUES (${DID}, ${HANDLE})
      ON CONFLICT (did) DO NOTHING
    `;

    await installNativeBridge(page);
    await page.goto('/app/signin');
    await page.getByRole('button', { name: /^sign in$/i }).click();

    // The app generated a PKCE verifier and opened the browser with its
    // challenge. Mint a code bound to *that* challenge, exactly as the real
    // OAuth callback would, so the exchange the app is about to attempt
    // validates against the verifier it is holding.
    await expect.poll(async () => browserOpenUrl(page)).not.toBe('');
    const challenge = new URL(await browserOpenUrl(page)).searchParams.get(
      'challenge',
    );
    expect(challenge).toBeTruthy();

    const code = randomBytes(32).toString('base64url');
    await sql`
      INSERT INTO app_token_codes (code_hash, did, challenge, expires_at)
      VALUES (${sha256hex(code)}, ${DID}, ${challenge}, ${new Date(Date.now() + 60_000)})
    `;

    await fireAppUrlOpen(page, `bio.cuanto.app://auth?code=${code}`);

    // onSignedIn navigates to /app, which redirects into the signed-in app. A
    // 401 would have bounced back to /app/signin, so landing here proves the
    // bearer token authenticated /api/me for real.
    await expect(page).toHaveURL(/\/app\/protocols\/following/, {
      timeout: 10_000,
    });
    await expect(
      page.getByRole('heading', { name: /sign in to cuanto/i }),
    ).toHaveCount(0);
  });

  test('returns to the page that sent the user to sign in', async ({
    page,
    sql,
  }) => {
    await sql`
      INSERT INTO users (did, handle) VALUES (${DID}, ${HANDLE})
      ON CONFLICT (did) DO NOTHING
    `;

    await installNativeBridge(page);
    // The "Session expired" alert on /app/surveys links here with its own path
    // as returnTo (via signInHref); the native handoff has no cookie to carry
    // it, so /app/signin has to hold it across the system-browser round trip.
    await page.goto('/app/signin?returnTo=%2Fapp%2Fsurveys');
    await page.getByRole('button', { name: /^sign in$/i }).click();

    await expect.poll(async () => browserOpenUrl(page)).not.toBe('');
    const challenge = new URL(await browserOpenUrl(page)).searchParams.get(
      'challenge',
    );
    const code = randomBytes(32).toString('base64url');
    await sql`
      INSERT INTO app_token_codes (code_hash, did, challenge, expires_at)
      VALUES (${sha256hex(code)}, ${DID}, ${challenge}, ${new Date(Date.now() + 60_000)})
    `;

    await fireAppUrlOpen(page, `bio.cuanto.app://auth?code=${code}`);

    await expect(page).toHaveURL(/\/app\/surveys$/, { timeout: 10_000 });
    await expect(
      page.getByRole('heading', { name: /your surveys/i }),
    ).toBeVisible();
  });

  test('ignores an off-site returnTo and falls back to the app home', async ({
    page,
    sql,
  }) => {
    await sql`
      INSERT INTO users (did, handle) VALUES (${DID}, ${HANDLE})
      ON CONFLICT (did) DO NOTHING
    `;

    await installNativeBridge(page);
    await page.goto('/app/signin?returnTo=https%3A%2F%2Fevil.example');
    await page.getByRole('button', { name: /^sign in$/i }).click();

    await expect.poll(async () => browserOpenUrl(page)).not.toBe('');
    const challenge = new URL(await browserOpenUrl(page)).searchParams.get(
      'challenge',
    );
    const code = randomBytes(32).toString('base64url');
    await sql`
      INSERT INTO app_token_codes (code_hash, did, challenge, expires_at)
      VALUES (${sha256hex(code)}, ${DID}, ${challenge}, ${new Date(Date.now() + 60_000)})
    `;

    await fireAppUrlOpen(page, `bio.cuanto.app://auth?code=${code}`);

    await expect(page).toHaveURL(/\/app\/protocols\/following/, {
      timeout: 10_000,
    });
  });
});
