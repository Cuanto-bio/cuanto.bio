import { beforeEach, describe, expect, test, vi } from 'vitest';

// SIGNED_OUT_TABS feeds both the mobile bottom nav (mobile-nav.svelte) and
// the desktop sidebar's "Sign in" entry. Its href has to route through
// signInPath() rather than a hardcoded web path, or a native user tapping it
// lands on /auth/signin, which the native bundle can't service — see
// $lib/auth/signin.ts.

const env = { native: false };
vi.mock('$lib/platform', () => ({
  isNative: () => env.native,
}));

beforeEach(() => {
  env.native = false;
  vi.resetModules();
});

describe('SIGNED_OUT_TABS', () => {
  test('sends web users to the server-rendered sign-in form', async () => {
    env.native = false;
    const { SIGNED_OUT_TABS } = await import('./nav-tabs');
    const signin = SIGNED_OUT_TABS.find((t) => t.key === 'signin');
    expect(signin?.href).toBe('/auth/signin');
  });

  test('sends native users to the in-bundle sign-in route', async () => {
    env.native = true;
    const { SIGNED_OUT_TABS } = await import('./nav-tabs');
    const signin = SIGNED_OUT_TABS.find((t) => t.key === 'signin');
    expect(signin?.href).toBe('/app/signin');
  });
});
