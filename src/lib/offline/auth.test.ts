import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// signOut() has two real audiences: cookie-based web clients and bearer-token
// native clients. A native client has no cookie to delete, so /auth/signout
// (which only clears the `did` cookie) does nothing for it — the bearer
// token in localStorage has to be revoked server-side and dropped locally,
// or a force-quit/relaunch leaves the user still signed in, since that's
// exactly what /app/+layout.ts's guard checks via /api/me. See
// $lib/auth/token.ts and src/routes/api/auth/signout/+server.ts.

const env = { native: false };
vi.mock('$lib/platform', () => ({
  isNative: () => env.native,
}));

const mocks = vi.hoisted(() => ({
  clearToken: vi.fn(),
  clearIdb: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('$lib/auth/token', () => ({ clearToken: mocks.clearToken }));
vi.mock('$lib/offline/db', () => ({ clearIdb: mocks.clearIdb }));

let fetchMock: ReturnType<typeof vi.fn>;
let location: { href: string };

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  env.native = false;
  location = { href: '' };
  vi.stubGlobal('window', { location });
  fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signOut', () => {
  test('web: clears offline data and goes to the cookie-clearing route', async () => {
    const { signOut } = await import('./auth');
    await signOut();

    expect(mocks.clearIdb).toHaveBeenCalled();
    expect(location.href).toBe('/auth/signout');
    // Nothing to revoke: a cookie client never had a bearer token.
    expect(mocks.clearToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('native: revokes and clears the bearer token instead of the cookie route', async () => {
    env.native = true;
    const { signOut } = await import('./auth');
    await signOut();

    expect(mocks.clearIdb).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/signout', {
      method: 'POST',
    });
    expect(mocks.clearToken).toHaveBeenCalled();
    expect(location.href).toBe('/app/signin');
  });

  test('native: still clears the local token if the server-side revoke fails', async () => {
    env.native = true;
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const { signOut } = await import('./auth');
    await signOut();

    // The button must not do nothing just because the revoke request failed
    // — the local token is what the guard actually checks on relaunch.
    expect(mocks.clearToken).toHaveBeenCalled();
    expect(location.href).toBe('/app/signin');
  });
});
