import { isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// The native shell reaches this route whenever a server-rendered page bounces
// an unauthenticated visitor here (e.g. the protocol editor's load). The web
// form is useless there: its PDS redirect leaves cuanto.bio, so App-Bound
// Domains hands the whole flow to the system browser and the user finishes
// signed in on the website with the app still signed out. The native flow
// lives at /app/signin, so send them there instead.

const env = { native: false };
vi.mock('$lib/platform', () => ({ isNative: () => env.native }));

import { NATIVE_SIGNIN_PATH } from '$lib/auth/signin';
import { load } from './+page';

beforeEach(() => {
  env.native = false;
});

function loadWith(href: string) {
  // Only `url` is read; the rest of the load event is irrelevant here.
  return () => load({ url: new URL(href) } as Parameters<typeof load>[0]);
}

describe('/auth/signin universal load', () => {
  test('leaves web visitors on the server-rendered form', () => {
    env.native = false;
    expect(loadWith('https://cuanto.bio/auth/signin')()).toBeUndefined();
  });

  test('sends native visitors to the native sign-in route', () => {
    env.native = true;
    let thrown: unknown;
    try {
      loadWith('https://cuanto.bio/auth/signin')();
    } catch (err) {
      thrown = err;
    }
    expect(isRedirect(thrown)).toBe(true);
    expect(thrown).toMatchObject({ location: NATIVE_SIGNIN_PATH });
  });

  test('carries returnTo across to the native route', () => {
    env.native = true;
    let thrown: unknown;
    try {
      loadWith(
        'https://cuanto.bio/auth/signin?returnTo=%2Fprotocols%2Fdana%2Fabc%2Fedit',
      )();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({
      location: `${NATIVE_SIGNIN_PATH}?returnTo=%2Fprotocols%2Fdana%2Fabc%2Fedit`,
    });
  });

  test('drops an off-site returnTo rather than forwarding it', () => {
    env.native = true;
    let thrown: unknown;
    try {
      loadWith('https://cuanto.bio/auth/signin?returnTo=//evil.example')();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({ location: NATIVE_SIGNIN_PATH });
  });
});
