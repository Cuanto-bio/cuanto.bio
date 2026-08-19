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

describe('SIGNED_IN_TABS', () => {
  // The mobile bottom nav renders only these tabs, and the native wrapper
  // launches straight into /app with no address bar. Without an entry here the
  // diagnostic log is unreachable on the exact device whose failures it exists
  // to explain — see https://tangled.org/cuanto.bio/cuanto.bio/issues/50.
  test('offers the diagnostic log under Explore', async () => {
    const { SIGNED_IN_TABS } = await import('./nav-tabs');
    const explore = SIGNED_IN_TABS.find((t) => t.key === 'explore');
    expect(explore?.type).toBe('popover');
    const hrefs =
      explore?.type === 'popover' ? explore.items.map((i) => i.href) : [];
    expect(hrefs).toContain('/app/log');
  });
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
