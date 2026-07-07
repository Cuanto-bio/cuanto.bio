import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/pds', () => ({
  createRecord: vi.fn(),
  PdsSessionExpiredError: class PdsSessionExpiredError extends Error {
    constructor() {
      super('AT Protocol session expired. Please sign in again.');
    }
  },
}));

vi.mock('$lib/server/db/survey-protocols', () => ({
  insertProtocol: vi.fn(),
  insertTarget: vi.fn(),
}));

vi.mock('$lib/server/db', () => ({
  default: vi.fn().mockResolvedValue([{ handle: 'user-test' }]),
}));

import { createRecord, PdsSessionExpiredError } from '$lib/server/pds';
import { actions } from './+page.server';

const FAKE_CID = 'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34';
const DID = 'did:test:protocols-new-spec';

function makeFormRequest(fields: Record<string, string>): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields))
    formData.append(key, value);
  return new Request('http://localhost/protocols/new', {
    method: 'POST',
    body: formData,
  });
}

async function submitProtocol(fields: Record<string, string>) {
  try {
    // redirect() throws in SvelteKit — catch it so tests can continue
    // biome-ignore lint/complexity/noBannedTypes: Seems ok for a test
    return await (actions as Record<string, Function>).default({
      request: makeFormRequest(fields),
      locals: { did: DID },
    });
  } catch {
    return null;
  }
}

describe('POST /protocols/new — createRecord payload with locationOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createRecord).mockResolvedValue({
      uri: `at://${DID}/bio.cuanto.surveyProtocol/test1`,
      cid: FAKE_CID,
    });
  });

  test('calls /xrpc/com.atproto.repo.createRecord with a name-only location', async () => {
    await submitProtocol({
      title: 'Test Protocol',
      description: 'A test',
      targets: '[]',
      locationOptions: JSON.stringify([{ name: 'Mission Creek' }]),
    });

    expect(createRecord).toHaveBeenCalledWith(
      DID,
      'bio.cuanto.surveyProtocol',
      expect.objectContaining({
        locationOptions: [
          expect.objectContaining({
            $type: 'org.atgeo.place',
            name: 'Mission Creek',
          }),
        ],
      }),
    );
    const [, , record] = vi.mocked(createRecord).mock.calls[0];
    expect(
      (record as Record<string, unknown[]>).locationOptions[0],
    ).not.toHaveProperty('locations');
  });

  test('calls /xrpc/com.atproto.repo.createRecord with geo coordinates', async () => {
    await submitProtocol({
      title: 'Test Protocol',
      description: 'A test',
      targets: '[]',
      locationOptions: JSON.stringify([
        {
          name: 'China Camp',
          locations: [
            {
              $type: 'community.lexicon.location.geo',
              latitude: '38.0040',
              longitude: '-122.4978',
            },
          ],
        },
      ]),
    });

    expect(createRecord).toHaveBeenCalledWith(
      DID,
      'bio.cuanto.surveyProtocol',
      expect.objectContaining({
        locationOptions: [
          expect.objectContaining({
            $type: 'org.atgeo.place',
            name: 'China Camp',
            locations: [
              expect.objectContaining({
                $type: 'community.lexicon.location.geo',
                latitude: '38.0040',
                longitude: '-122.4978',
              }),
            ],
          }),
        ],
      }),
    );
  });

  test('calls /xrpc/com.atproto.repo.createRecord with an address location', async () => {
    await submitProtocol({
      title: 'Test Protocol',
      description: 'A test',
      targets: '[]',
      locationOptions: JSON.stringify([
        {
          name: 'Coyote Hills',
          locations: [
            {
              $type: 'community.lexicon.location.address',
              country: 'US',
              region: 'CA',
              locality: 'Fremont',
              postalCode: '94538',
              street: '',
            },
          ],
        },
      ]),
    });

    expect(createRecord).toHaveBeenCalledWith(
      DID,
      'bio.cuanto.surveyProtocol',
      expect.objectContaining({
        locationOptions: [
          expect.objectContaining({
            $type: 'org.atgeo.place',
            name: 'Coyote Hills',
            locations: [
              expect.objectContaining({
                $type: 'community.lexicon.location.address',
                country: 'US',
                region: 'CA',
                locality: 'Fremont',
                postalCode: '94538',
              }),
            ],
          }),
        ],
      }),
    );
    // street was empty — must not be included in the payload
    const [, , record] = vi.mocked(createRecord).mock.calls[0];
    const loc = (
      record as Record<string, { locations: Record<string, unknown>[] }[]>
    ).locationOptions[0].locations[0];
    expect(loc).not.toHaveProperty('street');
  });

  test('calls /xrpc/com.atproto.repo.createRecord without locationOptions when none provided', async () => {
    await submitProtocol({
      title: 'Test Protocol',
      description: 'A test',
      targets: '[]',
      locationOptions: '[]',
    });

    const [, , record] = vi.mocked(createRecord).mock.calls[0];
    expect(record).not.toHaveProperty('locationOptions');
  });
});

describe('POST /protocols/new — locationOptions validation failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createRecord).mockResolvedValue({
      uri: `at://${DID}/bio.cuanto.surveyProtocol/test1`,
      cid: FAKE_CID,
    });
  });

  test('returns fail(422) when locationOptions is invalid JSON', async () => {
    const result = await submitProtocol({
      title: 'Test Protocol',
      description: 'A test',
      targets: '[]',
      locationOptions: 'not valid json',
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe(422);
    expect((result?.data as { error: string }).error).toContain(
      'Invalid location options',
    );
  });

  test('returns fail(422) when address country is empty', async () => {
    const result = await submitProtocol({
      title: 'Test Protocol',
      description: 'A test',
      targets: '[]',
      locationOptions: JSON.stringify([
        {
          name: 'Empty Country Place',
          locations: [
            {
              $type: 'community.lexicon.location.address',
              country: '',
            },
          ],
        },
      ]),
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe(422);
  });

  test('returns fail(422) when coordinate values are null', async () => {
    const result = await submitProtocol({
      title: 'Test Protocol',
      description: 'A test',
      targets: '[]',
      locationOptions: JSON.stringify([
        {
          name: 'Bad Location',
          locations: [
            {
              $type: 'community.lexicon.location.geo',
              latitude: null,
              longitude: null,
            },
          ],
        },
      ]),
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe(422);
    expect((result?.data as { error: string }).error).toContain(
      'Invalid location options',
    );
  });
});

describe('POST /protocols/new — PDS session expiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns fail(401) with sessionExpired when createRecord throws PdsSessionExpiredError', async () => {
    vi.mocked(createRecord).mockRejectedValueOnce(new PdsSessionExpiredError());

    const result = await submitProtocol({
      title: 'Test Protocol',
      description: 'A test',
      targets: '[]',
      locationOptions: '[]',
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe(401);
    expect((result?.data as { sessionExpired?: boolean }).sessionExpired).toBe(
      true,
    );
  });
});
