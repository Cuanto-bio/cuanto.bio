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
  isSafeReturnTo,
  isSignInPath,
  NATIVE_SIGNIN_PATH,
  signInHref,
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

describe('isSafeReturnTo', () => {
  test('accepts a root-relative path', () => {
    expect(isSafeReturnTo('/app/surveys')).toBe(true);
  });

  test('rejects protocol-relative and absolute URLs, and empty input', () => {
    // A crafted `//evil.example` or `https://…` would bounce the user off-site
    // through our own sign-in flow.
    expect(isSafeReturnTo('//evil.example')).toBe(false);
    expect(isSafeReturnTo('https://evil.example')).toBe(false);
    expect(isSafeReturnTo(null)).toBe(false);
    expect(isSafeReturnTo(undefined)).toBe(false);
    expect(isSafeReturnTo('')).toBe(false);
  });
});

describe('signInHref', () => {
  test('web: appends an encoded returnTo the callback can honour', () => {
    env.native = false;
    expect(signInHref('/app/surveys')).toBe(
      `${WEB_SIGNIN_PATH}?returnTo=%2Fapp%2Fsurveys`,
    );
  });

  test('native: points at the in-bundle route with the same returnTo', () => {
    env.native = true;
    expect(signInHref('/app/surveys')).toBe(
      `${NATIVE_SIGNIN_PATH}?returnTo=%2Fapp%2Fsurveys`,
    );
  });

  test('omits returnTo when it is missing', () => {
    env.native = false;
    expect(signInHref()).toBe(WEB_SIGNIN_PATH);
    env.native = true;
    expect(signInHref()).toBe(NATIVE_SIGNIN_PATH);
  });

  test('drops an off-site returnTo rather than forwarding it', () => {
    env.native = false;
    expect(signInHref('//evil.example')).toBe(WEB_SIGNIN_PATH);
    expect(signInHref('https://evil.example')).toBe(WEB_SIGNIN_PATH);
  });
});
