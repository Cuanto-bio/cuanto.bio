import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The native sign-in handoff: system-browser PKCE → custom-scheme callback →
// bearer-token exchange. This is the trickiest native seam, and its own comments
// record a past bug where callback failures were swallowed, leaving the user
// signed out after a *successful* browser sign-in. These tests pin that every
// failure path reports through onError (never silence), that the happy path
// stores the token and notifies exactly once, and that the PKCE verifier is
// single-use.
//
// native.ts keeps module-level state (the pending verifier, the
// listener-attached flag), so each test re-imports it fresh via resetModules().

const mocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  browserOpen: vi.fn().mockResolvedValue(undefined),
  browserClose: vi.fn().mockResolvedValue(undefined),
  setToken: vi.fn(),
}));

vi.mock('@capacitor/app', () => ({
  App: { addListener: mocks.addListener },
}));
vi.mock('@capacitor/browser', () => ({
  Browser: { open: mocks.browserOpen, close: mocks.browserClose },
}));
vi.mock('$lib/auth/token', () => ({ setToken: mocks.setToken }));

const ORIGIN = 'https://cuanto.bio';
type UrlEvent = { url: string };
type Handler = (e: UrlEvent) => Promise<void>;

let fetchMock: ReturnType<typeof vi.fn>;

/** SHA-256(verifier) as base64url — the server's expected PKCE challenge. */
function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** The challenge native.ts sent to the browser on the Nth startNativeSignIn. */
function challengeFromOpen(call = 0): string | null {
  const { url } = mocks.browserOpen.mock.calls[call][0];
  return new URL(url).searchParams.get('challenge');
}

/**
 * Load native.ts with fresh module state and attach the auth listener the way
 * the client does on startup. Returns the captured appUrlOpen handler and the
 * caller-facing callbacks so tests can drive and assert the handoff.
 */
async function setup() {
  vi.resetModules();
  const onSignedIn = vi.fn();
  const onError = vi.fn();
  const mod = await import('./native');
  mod.initNativeAuth({ onSignedIn, onError });
  const handler = mocks.addListener.mock.calls.at(-1)?.[1] as Handler;
  return { mod, onSignedIn, onError, handler };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('location', { origin: ORIGIN, href: `${ORIGIN}/app` });
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ token: 'tok-default' }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('initNativeAuth', () => {
  test('attaches an appUrlOpen listener', async () => {
    await setup();
    expect(mocks.addListener).toHaveBeenCalledTimes(1);
    expect(mocks.addListener.mock.calls[0][0]).toBe('appUrlOpen');
  });

  test('is idempotent: a second call does not attach a duplicate listener', async () => {
    const { mod } = await setup();
    mod.initNativeAuth({ onSignedIn: vi.fn(), onError: vi.fn() });
    expect(mocks.addListener).toHaveBeenCalledTimes(1);
  });

  test('routes callbacks to the latest handlers after a remount', async () => {
    // The sign-in page registers fresh closures every time it mounts. A remount
    // (sign out, return to the page) must not leave the listener bound to the
    // first mount's now-destroyed component.
    const { mod, onError: firstOnError, handler } = await setup();
    const secondOnError = vi.fn();
    mod.initNativeAuth({ onSignedIn: vi.fn(), onError: secondOnError });

    // A callback with no code takes the onError path without needing a verifier.
    await handler({ url: 'bio.cuanto.app://auth' });

    expect(secondOnError).toHaveBeenCalledTimes(1);
    expect(secondOnError.mock.calls[0][0]).toMatch(/no code/i);
    expect(firstOnError).not.toHaveBeenCalled();
  });
});

describe('startNativeSignIn', () => {
  test('opens the system browser at the native sign-in URL', async () => {
    const { mod } = await setup();
    await mod.startNativeSignIn();
    expect(mocks.browserOpen).toHaveBeenCalledTimes(1);
    const { url } = mocks.browserOpen.mock.calls[0][0];
    expect(
      url.startsWith(`${ORIGIN}/auth/signin?client=native&challenge=`),
    ).toBe(true);
  });

  test('sends an S256 PKCE challenge (43-char base64url, no padding)', async () => {
    const { mod } = await setup();
    await mod.startNativeSignIn();
    expect(challengeFromOpen()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test('uses a fresh challenge on each sign-in', async () => {
    const { mod } = await setup();
    await mod.startNativeSignIn();
    await mod.startNativeSignIn();
    expect(challengeFromOpen(0)).not.toBe(challengeFromOpen(1));
  });
});

describe('callback handling', () => {
  test('ignores a URL that is not the app callback scheme', async () => {
    const { onError, onSignedIn, handler } = await setup();
    await handler({ url: 'https://evil.example/auth?code=stolen' });
    expect(onError).not.toHaveBeenCalled();
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(mocks.setToken).not.toHaveBeenCalled();
    expect(mocks.browserClose).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('reports an error when the callback carries no code', async () => {
    const { onError, onSignedIn, handler } = await setup();
    await handler({ url: 'bio.cuanto.app://auth' });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatch(/no code/i);
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(mocks.setToken).not.toHaveBeenCalled();
    // The browser is dismissed even on a bad callback, so the user is not left
    // staring at the redirect page.
    expect(mocks.browserClose).toHaveBeenCalled();
  });

  test('reports the restart error when the verifier is gone (cold relaunch)', async () => {
    // No startNativeSignIn(), so the pending verifier is null: the app was
    // relaunched between opening the browser and the callback arriving.
    const { onError, onSignedIn, handler } = await setup();
    await handler({ url: 'bio.cuanto.app://auth?code=abc123' });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatch(/restart/i);
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(mocks.setToken).not.toHaveBeenCalled();
    // Nothing to exchange without a verifier — never hit the API.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('reports a token-exchange failure with its HTTP status', async () => {
    const { mod, onError, onSignedIn, handler } = await setup();
    await mod.startNativeSignIn();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    await handler({ url: 'bio.cuanto.app://auth?code=abc123' });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatch(/401/);
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(mocks.setToken).not.toHaveBeenCalled();
  });

  test('reports a network failure during exchange', async () => {
    const { mod, onError, onSignedIn, handler } = await setup();
    await mod.startNativeSignIn();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await handler({ url: 'bio.cuanto.app://auth?code=abc123' });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(mocks.setToken).not.toHaveBeenCalled();
  });

  test('completes sign-in: stores the token and notifies once', async () => {
    const { mod, onSignedIn, onError, handler } = await setup();
    await mod.startNativeSignIn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'tok-xyz' }),
    });
    await handler({ url: 'bio.cuanto.app://auth?code=the-code' });

    expect(mocks.setToken).toHaveBeenCalledWith('tok-xyz');
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(mocks.browserClose).toHaveBeenCalled();
  });

  test('exchanges the code and PKCE verifier at /api/auth/token', async () => {
    const { mod, handler } = await setup();
    await mod.startNativeSignIn();
    const challenge = challengeFromOpen();

    await handler({ url: 'bio.cuanto.app://auth?code=the-code' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/auth/token');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.code).toBe('the-code');
    expect(body.label).toBe('ios-app');
    // The verifier posted must be the pre-image of the challenge sent to the
    // browser, or the server's PKCE check would reject a legitimate sign-in.
    expect(s256(body.verifier)).toBe(challenge);
  });

  test('the verifier is single-use: a replayed callback cannot exchange again', async () => {
    const { mod, onSignedIn, onError, handler } = await setup();
    await mod.startNativeSignIn();
    await handler({ url: 'bio.cuanto.app://auth?code=first' });
    expect(onSignedIn).toHaveBeenCalledTimes(1);

    await handler({ url: 'bio.cuanto.app://auth?code=second' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.setToken).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatch(/restart/i);
  });
});
