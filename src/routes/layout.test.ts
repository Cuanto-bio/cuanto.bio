import { beforeEach, describe, expect, test, vi } from 'vitest';

const env = { browser: false, native: false, onLine: true };

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

vi.stubGlobal('navigator', {
  get onLine() {
    return env.onLine;
  },
});

import { load } from './+layout';

const CACHED = { did: 'did:plc:dana', handle: 'dana', avatarUrl: 'd.png' };

function run(pathname: string) {
  // The root layout load only ever touches `url`.
  return load({
    url: new URL(`https://cuanto.bio${pathname}`),
  } as unknown as Parameters<typeof load>[0]);
}

beforeEach(() => {
  env.browser = true;
  env.native = false;
  env.onLine = true;
  getIdbUser.mockReset();
  getIdbUser.mockResolvedValue(CACHED);
});

describe('root layout load', () => {
  test('answers with the cached user on a public route in the native shell', async () => {
    // When a route's own load fails, this layout's data is all the error
    // boundary has left, and it used to report signed out — dropping the nav to
    // the signed-out tabs mid-session.
    // https://tangled.org/cuanto.bio/cuanto.bio/issues/54
    env.native = true;
    expect(await run('/surveys')).toEqual(CACHED);
  });

  test('answers with the cached user on a public route while offline', async () => {
    env.onLine = false;
    expect(await run('/surveys')).toEqual(CACHED);
  });

  test('leaves /app to its own layout, which is authoritative there', async () => {
    // app/+layout.ts asks /api/me and clears the cache on a 401, so a fallback
    // here would only add a staler answer that its data overrides anyway.
    env.native = true;
    expect(await run('/app/surveys')).toEqual({
      did: undefined,
      handle: null,
      avatarUrl: null,
    });
    expect(getIdbUser).not.toHaveBeenCalled();
  });

  test('stays cookie-authoritative on the online web', async () => {
    expect(await run('/surveys')).toEqual({
      did: undefined,
      handle: null,
      avatarUrl: null,
    });
    expect(getIdbUser).not.toHaveBeenCalled();
  });
});
