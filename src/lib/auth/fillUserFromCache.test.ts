import { beforeEach, describe, expect, test, vi } from 'vitest';

// The fill logic branches on four inputs; mock each so the native path
// (browser + native shell + no server-resolved cookie) is reachable in the node
// test environment, where `browser` is otherwise always false.
const env = { browser: false, native: false, onLine: true };

vi.stubGlobal('navigator', {
  get onLine() {
    return env.onLine;
  },
});

vi.mock('$app/environment', () => ({
  get browser() {
    return env.browser;
  },
}));

vi.mock('$lib/platform', () => ({
  isNative: () => env.native,
}));

const getIdbUser = vi.fn();
vi.mock('$lib/offline/db', () => ({
  getIdbUser: () => getIdbUser(),
}));

import { fillUserFromCache } from './fillUserFromCache';

const SIGNED_OUT = { did: undefined, handle: null, avatarUrl: null };

beforeEach(() => {
  env.browser = false;
  env.native = false;
  env.onLine = true;
  getIdbUser.mockReset();
});

describe('fillUserFromCache', () => {
  test('passes through the user the server resolved from the cookie (web)', async () => {
    const data = { did: 'did:plc:alice', handle: 'alice', avatarUrl: 'a.png' };
    env.browser = true;
    expect(await fillUserFromCache(data)).toEqual(data);
    expect(getIdbUser).not.toHaveBeenCalled();
  });

  test('does not consult IndexedDB on the web, even when signed out', async () => {
    // Web is cookie-authoritative: a stale cached user must not resurrect a
    // signed-in sidebar after the server already said signed-out.
    env.browser = true;
    env.native = false;
    getIdbUser.mockResolvedValue({ did: 'did:plc:stale', handle: 'stale' });
    expect(await fillUserFromCache(SIGNED_OUT)).toEqual(SIGNED_OUT);
    expect(getIdbUser).not.toHaveBeenCalled();
  });

  test('leaves data untouched during server rendering (no browser)', async () => {
    env.browser = false;
    env.native = true;
    expect(await fillUserFromCache(SIGNED_OUT)).toEqual(SIGNED_OUT);
    expect(getIdbUser).not.toHaveBeenCalled();
  });

  test('fills the user from the cache in the native client (no cookie)', async () => {
    env.browser = true;
    env.native = true;
    getIdbUser.mockResolvedValue({
      did: 'did:plc:bob',
      handle: 'bob',
      avatarUrl: 'b.png',
    });
    expect(await fillUserFromCache(SIGNED_OUT)).toEqual({
      did: 'did:plc:bob',
      handle: 'bob',
      avatarUrl: 'b.png',
    });
  });

  test('normalizes a cached user without an avatar to null', async () => {
    env.browser = true;
    env.native = true;
    getIdbUser.mockResolvedValue({ did: 'did:plc:bob', handle: 'bob' });
    expect(await fillUserFromCache(SIGNED_OUT)).toEqual({
      did: 'did:plc:bob',
      handle: 'bob',
      avatarUrl: null,
    });
  });

  test('stays signed out when the native client has no cached user', async () => {
    env.browser = true;
    env.native = true;
    getIdbUser.mockResolvedValue(undefined);
    expect(await fillUserFromCache(SIGNED_OUT)).toEqual(SIGNED_OUT);
  });

  test('stays signed out when IndexedDB throws', async () => {
    env.browser = true;
    env.native = true;
    getIdbUser.mockRejectedValue(new Error('IDB blocked'));
    expect(await fillUserFromCache(SIGNED_OUT)).toEqual(SIGNED_OUT);
  });

  test('fills the user from the cache offline on the web (no server to ask)', async () => {
    // Cookie-authoritative only holds while there is a server to answer. Offline
    // the layout's server load never runs, so the cache is the only witness —
    // and it is kept honest, since /app/+layout.ts clears it on a 401 and
    // signOut() clears it outright.
    // https://tangled.org/cuanto.bio/cuanto.bio/issues/54
    env.browser = true;
    env.native = false;
    env.onLine = false;
    getIdbUser.mockResolvedValue({
      did: 'did:plc:carol',
      handle: 'carol',
      avatarUrl: 'c.png',
    });
    expect(await fillUserFromCache(SIGNED_OUT)).toEqual({
      did: 'did:plc:carol',
      handle: 'carol',
      avatarUrl: 'c.png',
    });
  });

  test('preserves non-user fields when filling (e.g. page data)', async () => {
    // /lexicons returns diagram data alongside the user; filling the user in
    // must not drop it.
    env.browser = true;
    env.native = true;
    getIdbUser.mockResolvedValue({ did: 'did:plc:bob', handle: 'bob' });
    const data = { ...SIGNED_OUT, lexicons: { a: 1 }, layouts: ['x'] };
    expect(await fillUserFromCache(data)).toEqual({
      did: 'did:plc:bob',
      handle: 'bob',
      avatarUrl: null,
      lexicons: { a: 1 },
      layouts: ['x'],
    });
  });
});
