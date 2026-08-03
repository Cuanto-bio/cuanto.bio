import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/app-tokens', async () => {
  // isBearerHeader is pure header parsing with no I/O, so the real one is used
  // here — mocking it would just restate the implementation.
  const actual = await vi.importActual<typeof import('$lib/server/app-tokens')>(
    '$lib/server/app-tokens',
  );
  return { isBearerHeader: actual.isBearerHeader, resolveBearerDid: vi.fn() };
});
vi.mock('$lib/server/db', () => ({ default: vi.fn() }));
vi.mock('$lib/server/logger', () => ({
  default: { child: () => ({ info: vi.fn() }) },
}));

import { resolveBearerDid } from '$lib/server/app-tokens';
import { handle } from './hooks.server';

const COOKIE_DID = 'did:test:from-cookie';
const TOKEN_DID = 'did:test:from-token';

function makeEvent({
  cookie,
  authorization,
}: {
  cookie?: string;
  authorization?: string;
} = {}) {
  const headers = new Headers();
  if (authorization) headers.set('authorization', authorization);
  return {
    locals: {} as App.Locals,
    cookies: { get: (name: string) => (name === 'did' ? cookie : undefined) },
    request: { method: 'GET', headers },
    url: new URL('http://localhost/api/me'),
  };
}

async function run(opts?: { cookie?: string; authorization?: string }) {
  const event = makeEvent(opts);
  const resolve = vi
    .fn()
    .mockResolvedValue(new Response('', { status: 200, headers: {} }));
  // biome-ignore lint/suspicious/noExplicitAny: minimal RequestEvent stand-in
  await handle({ event: event as any, resolve });
  return event.locals.did;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks.server handle — authentication', () => {
  test('resolves the DID from the cookie when there is no auth header', async () => {
    await expect(run({ cookie: COOKIE_DID })).resolves.toBe(COOKIE_DID);
    expect(resolveBearerDid).not.toHaveBeenCalled();
  });

  test('leaves locals.did undefined when neither is present', async () => {
    await expect(run()).resolves.toBeUndefined();
  });

  test('resolves the DID from a valid bearer token', async () => {
    vi.mocked(resolveBearerDid).mockResolvedValue(TOKEN_DID);
    await expect(run({ authorization: `Bearer tok` })).resolves.toBe(TOKEN_DID);
  });

  test('bearer token wins over a cookie when both are sent', async () => {
    vi.mocked(resolveBearerDid).mockResolvedValue(TOKEN_DID);
    await expect(
      run({ cookie: COOKIE_DID, authorization: 'Bearer tok' }),
    ).resolves.toBe(TOKEN_DID);
  });

  // The important one. An Authorization header is a deliberate act by the
  // client, so it decides the outcome: a revoked or expired token must not
  // quietly succeed on the strength of a stale cookie sitting alongside it.
  test('an invalid bearer token does NOT fall back to the cookie', async () => {
    vi.mocked(resolveBearerDid).mockResolvedValue(undefined);
    await expect(
      run({ cookie: COOKIE_DID, authorization: 'Bearer revoked' }),
    ).resolves.toBeUndefined();
  });

  test('a non-Bearer Authorization header leaves the cookie in charge', async () => {
    // resolveBearerDid returns undefined for schemes it does not recognise, so
    // an unrelated Authorization header (a proxy's Basic auth, say) must not
    // lock out a legitimately cookie-authenticated browser request.
    vi.mocked(resolveBearerDid).mockResolvedValue(undefined);
    await expect(
      run({ cookie: COOKIE_DID, authorization: 'Basic abc' }),
    ).resolves.toBe(COOKIE_DID);
  });
});
