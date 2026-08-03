import { beforeEach, describe, expect, test, vi } from 'vitest';

// signInPath() decides where an unauthenticated user is sent, which differs by
// platform: the native bundle has no /auth/signin, so sending a native user
// there is a blank screen. isSignInPath() is what stops the /app layout guard
// from redirecting to the sign-in route forever, so both branches matter.

const env = { native: false };
vi.mock('$lib/platform', () => ({
  isNative: () => env.native,
}));

import {
  isSignInPath,
  NATIVE_SIGNIN_PATH,
  signInPath,
  WEB_SIGNIN_PATH,
} from './signin';

beforeEach(() => {
  env.native = false;
});

describe('signInPath', () => {
  test('sends web users to the server-rendered form', () => {
    env.native = false;
    expect(signInPath()).toBe(WEB_SIGNIN_PATH);
  });

  test('sends native users to the in-bundle sign-in route', () => {
    env.native = true;
    expect(signInPath()).toBe(NATIVE_SIGNIN_PATH);
  });
});

describe('isSignInPath', () => {
  test('recognizes both the web and native sign-in routes', () => {
    expect(isSignInPath(WEB_SIGNIN_PATH)).toBe(true);
    expect(isSignInPath(NATIVE_SIGNIN_PATH)).toBe(true);
  });

  test('rejects any other path, so the guard only skips the route itself', () => {
    expect(isSignInPath('/app')).toBe(false);
    expect(isSignInPath('/')).toBe(false);
    // A prefix match would wrongly exempt sub-routes from the auth guard.
    expect(isSignInPath('/app/signin/extra')).toBe(false);
  });
});
