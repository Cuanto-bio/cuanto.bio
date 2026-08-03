import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isNative: vi.fn(() => true),
  getToken: vi.fn((): string | null => 'stored-token'),
  installVibrateBridge: vi.fn(),
}));

vi.mock('$lib/platform', () => ({ isNative: mocks.isNative }));
vi.mock('$lib/auth/token', () => ({ getToken: mocks.getToken }));
vi.mock('$lib/haptics', () => ({
  installVibrateBridge: mocks.installVibrateBridge,
}));

import { init } from './hooks.client';

const ORIGIN = 'https://cuanto.bio';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mocks.isNative.mockReturnValue(true);
  mocks.getToken.mockReturnValue('stored-token');
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
  // init is undefined on the pass-through path (non-/api or no token), where
  // the wrapper forwards the original arguments untouched.
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

  test('does not attach the token to a sibling path like /apiary', async () => {
    await globalThis.fetch(`${ORIGIN}/apiary/foo`);
    expect(initFromLastCall().has('authorization')).toBe(false);
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
