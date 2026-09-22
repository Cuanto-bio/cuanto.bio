import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/db/users', () => ({
  getDefaultRemarkLicense: vi.fn(),
  setDefaultRemarkLicense: vi.fn(),
}));

import {
  getDefaultRemarkLicense,
  setDefaultRemarkLicense,
} from '$lib/server/db/users';
import { GET, PUT } from './+server';

const DID = 'did:test:me-settings-spec';
const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/';
const CC_BY = 'https://creativecommons.org/licenses/by/4.0/';

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/me/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDefaultRemarkLicense).mockResolvedValue(null);
  vi.mocked(setDefaultRemarkLicense).mockResolvedValue(undefined);
});

describe('GET /api/me/settings', () => {
  test('returns 401 when signed out', async () => {
    const resp = await GET({ locals: {} } as unknown as Parameters<
      typeof GET
    >[0]);
    expect(resp.status).toBe(401);
  });

  test('falls back to CC0 when the user has never chosen a license', async () => {
    const resp = await GET({ locals: { did: DID } } as unknown as Parameters<
      typeof GET
    >[0]);
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ defaultRemarkLicense: CC0 });
  });

  test('returns the stored license', async () => {
    vi.mocked(getDefaultRemarkLicense).mockResolvedValue(CC_BY);
    const resp = await GET({ locals: { did: DID } } as unknown as Parameters<
      typeof GET
    >[0]);
    expect(await resp.json()).toEqual({ defaultRemarkLicense: CC_BY });
  });

  test('falls back to CC0 for a stored value we no longer offer', async () => {
    // An SPDX identifier from an older build must not reach the Select as a
    // value with no matching option.
    vi.mocked(getDefaultRemarkLicense).mockResolvedValue('CC-BY-4.0');
    const resp = await GET({ locals: { did: DID } } as unknown as Parameters<
      typeof GET
    >[0]);
    expect(await resp.json()).toEqual({ defaultRemarkLicense: CC0 });
  });
});

describe('PUT /api/me/settings', () => {
  test('returns 401 when signed out', async () => {
    const resp = await PUT({
      locals: {},
      request: makeRequest({ defaultRemarkLicense: CC_BY }),
    } as unknown as Parameters<typeof PUT>[0]);
    expect(resp.status).toBe(401);
    expect(setDefaultRemarkLicense).not.toHaveBeenCalled();
  });

  test('stores a known license', async () => {
    const resp = await PUT({
      locals: { did: DID },
      request: makeRequest({ defaultRemarkLicense: CC_BY }),
    } as unknown as Parameters<typeof PUT>[0]);
    expect(resp.status).toBe(200);
    expect(setDefaultRemarkLicense).toHaveBeenCalledWith(DID, CC_BY);
    expect(await resp.json()).toEqual({ defaultRemarkLicense: CC_BY });
  });

  test('returns 422 for a license we do not offer', async () => {
    const resp = await PUT({
      locals: { did: DID },
      request: makeRequest({ defaultRemarkLicense: 'CC-BY-4.0' }),
    } as unknown as Parameters<typeof PUT>[0]);
    expect(resp.status).toBe(422);
    expect(setDefaultRemarkLicense).not.toHaveBeenCalled();
  });

  test('returns 422 when the field is missing', async () => {
    const resp = await PUT({
      locals: { did: DID },
      request: makeRequest({}),
    } as unknown as Parameters<typeof PUT>[0]);
    expect(resp.status).toBe(422);
    expect(setDefaultRemarkLicense).not.toHaveBeenCalled();
  });
});
