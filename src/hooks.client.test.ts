import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isNative: vi.fn(() => true),
  getToken: vi.fn((): string | null => 'stored-token'),
  installVibrateBridge: vi.fn(),
  clearDeadCredential: vi.fn(async () => {}),
}));

vi.mock('$lib/platform', () => ({ isNative: mocks.isNative }));
vi.mock('$lib/auth/token', () => ({ getToken: mocks.getToken }));
vi.mock('$lib/auth/clearDeadCredential', () => ({
  clearDeadCredential: mocks.clearDeadCredential,
}));
vi.mock('$lib/haptics', () => ({
  installVibrateBridge: mocks.installVibrateBridge,
}));

import { init } from './hooks.client';

const ORIGIN = 'https://cuanto.bio';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isNative.mockReturnValue(true);
  mocks.getToken.mockReturnValue('stored-token');
  mocks.clearDeadCredential.mockResolvedValue(undefined);
  vi.stubGlobal('location', {
    protocol: 'https:',
    host: 'cuanto.bio',
    href: `${ORIGIN}/app`,
  });
  fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  // init() captures the current globalThis.fetch as the original and replaces
  // it with the bearer-attaching wrapper.
  init?.();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function initFromLastCall(): Headers {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  // init is undefined on the pass-through path (non-same-origin or no
  // token), where the wrapper forwards the original arguments untouched.
  const passedInit = fetchMock.mock.calls[0][1] as RequestInit | undefined;
  return new Headers(passedInit?.headers);
}

describe('native bearer fetch wrapper', () => {
  test('preserves headers on a Request and does not clobber its Authorization', async () => {
    const request = new Request(`${ORIGIN}/api/x`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer explicit',
      },
      body: '{}',
    });

    await globalThis.fetch(request);

    const headers = initFromLastCall();
    expect(headers.get('authorization')).toBe('Bearer explicit');
    expect(headers.get('content-type')).toBe('application/json');
  });

  test('attaches the token to a Request without Authorization, keeping its other headers', async () => {
    const request = new Request(`${ORIGIN}/api/y`, {
      headers: { 'X-Custom': 'v' },
    });

    await globalThis.fetch(request);

    const headers = initFromLastCall();
    expect(headers.get('authorization')).toBe('Bearer stored-token');
    expect(headers.get('x-custom')).toBe('v');
  });

  test('does not attach the token to a cross-origin request', async () => {
    // Same-origin is the boundary that matters: sending the credential to
    // iNaturalist, GBIF or a tile host would disclose it to a third party.
    await globalThis.fetch('https://api.inaturalist.org/v2/taxa');
    expect(initFromLastCall().has('authorization')).toBe(false);
  });

  test('attaches the token to a server-rendered page data request', async () => {
    // The wrapper loads the whole site, not just /app, so server-rendered
    // routes like the protocol editor authenticate through this wrapper too.
    // SvelteKit fetches their `load` data from `<path>/__data.json`, which is
    // nowhere near /api — restricting the token to /api left every such page
    // looking signed out to a signed-in native user.
    await globalThis.fetch(`${ORIGIN}/protocols/dana/abc/edit/__data.json`);
    expect(initFromLastCall().get('authorization')).toBe('Bearer stored-token');
  });

  test('attaches the token to a form action POST', async () => {
    // Enhanced forms submit to the page URL with a `?/action` query, so
    // saving an edit needs the token on the same paths as the load above.
    await globalThis.fetch(`${ORIGIN}/protocols/dana/abc/edit?/default`, {
      method: 'POST',
      body: new FormData(),
    });
    expect(initFromLastCall().get('authorization')).toBe('Bearer stored-token');
  });

  test('attaches the token to /api/ paths', async () => {
    await globalThis.fetch(`${ORIGIN}/api/me`);
    expect(initFromLastCall().get('authorization')).toBe('Bearer stored-token');
  });

  test('attaches the token to the bare /api path', async () => {
    await globalThis.fetch(`${ORIGIN}/api`);
    expect(initFromLastCall().get('authorization')).toBe('Bearer stored-token');
  });
});

describe('dead-session credential clearing', () => {
  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  test.each([
    ['401 pds_session_expired', 401, { error: 'pds_session_expired' }],
    ['401 sessionExpired flag', 401, { sessionExpired: true }],
    ['403 permissionRequired flag', 403, { permissionRequired: true }],
  ])('clears the credential on a same-origin %s', async (_label, status, body) => {
    fetchMock.mockResolvedValue(jsonResponse(status, body));
    await globalThis.fetch(`${ORIGIN}/api/surveys`, { method: 'POST' });
    expect(mocks.clearDeadCredential).toHaveBeenCalledOnce();
  });

  test('does not block the caller while the credential clear is in flight', async () => {
    // clearDeadCredential does a /auth/signout round-trip on the web; the
    // caller's own failed request must not wait for it.
    let release!: () => void;
    mocks.clearDeadCredential.mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: 'pds_session_expired' }),
    );

    const res = await globalThis.fetch(`${ORIGIN}/api/surveys`, {
      method: 'POST',
    });

    expect(res.status).toBe(401);
    expect(mocks.clearDeadCredential).toHaveBeenCalledOnce();
    release();
  });

  test('leaves the response body intact for the caller to read', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: 'pds_session_expired', message: 'gone' }),
    );
    const res = await globalThis.fetch(`${ORIGIN}/api/surveys`, {
      method: 'POST',
    });
    expect(await res.json()).toEqual({
      error: 'pds_session_expired',
      message: 'gone',
    });
  });

  test('ignores an ordinary unauthenticated 401 from /api/me', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));
    await globalThis.fetch(`${ORIGIN}/api/me`);
    expect(mocks.clearDeadCredential).not.toHaveBeenCalled();
  });

  test('ignores a successful response', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { did: 'did:x', handle: 'x' }),
    );
    await globalThis.fetch(`${ORIGIN}/api/me`);
    expect(mocks.clearDeadCredential).not.toHaveBeenCalled();
  });

  test('ignores a 401 with a non-JSON body without throwing', async () => {
    fetchMock.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    await expect(
      globalThis.fetch(`${ORIGIN}/api/surveys`, { method: 'POST' }),
    ).resolves.toBeDefined();
    expect(mocks.clearDeadCredential).not.toHaveBeenCalled();
  });

  test('never touches our credential for a cross-origin 401', async () => {
    // A third party's 401 body could coincidentally carry one of our markers;
    // the credential is ours and a cross-origin response has no say over it.
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: 'pds_session_expired' }),
    );
    await globalThis.fetch('https://api.inaturalist.org/v2/observations');
    expect(mocks.clearDeadCredential).not.toHaveBeenCalled();
  });

  test('runs on the web build too, where no bearer token is attached', async () => {
    mocks.isNative.mockReturnValue(false);
    mocks.installVibrateBridge.mockClear();
    vi.resetModules();
    // Drop the native wrapper the shared beforeEach installed so webInit wraps
    // the raw mock directly.
    vi.stubGlobal('fetch', fetchMock);
    const { init: webInit } = await import('./hooks.client');
    webInit?.();
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: 'pds_session_expired' }),
    );

    await globalThis.fetch(`${ORIGIN}/api/surveys`, { method: 'POST' });

    expect(mocks.clearDeadCredential).toHaveBeenCalledOnce();
    expect(mocks.installVibrateBridge).not.toHaveBeenCalled();
  });
});
