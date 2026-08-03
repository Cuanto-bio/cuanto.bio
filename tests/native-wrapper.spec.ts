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

  test('redirects an unauthenticated native user to the native sign-in route', async ({
    page,
  }) => {
    await installNativeBridge(page);
    await page.goto('/app');
    // /api/me is unauthenticated (no token, no cookie), so the guard bounces to
    // the native sign-in route — not the web form.
    await expect(page).toHaveURL(/\/app\/signin/);
    await expect(
      page.getByRole('heading', { name: /sign in to cuanto/i }),
    ).toBeVisible();
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
});
