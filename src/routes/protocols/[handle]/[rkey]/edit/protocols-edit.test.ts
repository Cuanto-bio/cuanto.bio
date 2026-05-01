import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/pds', () => ({
  putRecord: vi.fn(),
  deleteRecord: vi.fn(),
  createRecord: vi.fn(),
}));

vi.mock('$lib/server/db/survey-protocols', () => ({
  getProtocolDetailByHandleAndRkey: vi.fn(),
  insertProtocol: vi.fn(),
  insertTarget: vi.fn(),
  deleteTargetsByProtocolUri: vi.fn().mockResolvedValue([]),
}));

vi.mock('$lib/server/db', () => ({
  default: vi.fn().mockResolvedValue([{ did: 'did:test:protocols-edit-spec' }]),
}));

vi.mock('$lib/logger', () => ({
  default: { child: vi.fn().mockReturnValue({ error: vi.fn() }) },
}));

import { getProtocolDetailByHandleAndRkey } from '$lib/server/db/survey-protocols';
import { putRecord } from '$lib/server/pds';
import { actions } from './+page.server';

const FAKE_CID = 'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34';
const DID = 'did:test:protocols-edit-spec';
const HANDLE = 'user-edit-unit-spec';
const RKEY = 'testrkey';

const FAKE_PROTOCOL = {
  atUri: `at://${DID}/bio.lexicons.temp.surveyProtocol/${RKEY}`,
  rkey: RKEY,
  handle: HANDLE,
  record: {
    $type: 'bio.lexicons.temp.surveyProtocol',
    title: 'Original Title',
    description: 'Original Description',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  targets: [],
};

function makeFormRequest(fields: Record<string, string>): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields))
    formData.append(key, value);
  return new Request(`http://localhost/protocols/${HANDLE}/${RKEY}/edit`, {
    method: 'POST',
    body: formData,
  });
}

async function submitEdit(fields: Record<string, string>) {
  try {
    // biome-ignore lint/complexity/noBannedTypes: ok for test
    return await (actions as Record<string, Function>).default({
      request: makeFormRequest(fields),
      locals: { did: DID },
      params: { handle: HANDLE, rkey: RKEY },
    });
  } catch {
    return null;
  }
}

describe('POST /protocols/[handle]/[rkey]/edit — validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProtocolDetailByHandleAndRkey).mockResolvedValue(
      FAKE_PROTOCOL as never,
    );
    vi.mocked(putRecord).mockResolvedValue({
      uri: FAKE_PROTOCOL.atUri,
      cid: FAKE_CID,
    });
  });

  test('returns fail(422) when title is missing', async () => {
    const result = await submitEdit({
      title: '',
      description: 'A description',
      targets: '[]',
      locationOptions: '[]',
    });
    expect(result?.status).toBe(422);
    expect((result?.data as { error: string }).error).toContain(
      'Title is required',
    );
  });

  test('returns fail(422) when description is missing', async () => {
    const result = await submitEdit({
      title: 'A title',
      description: '',
      targets: '[]',
      locationOptions: '[]',
    });
    expect(result?.status).toBe(422);
    expect((result?.data as { error: string }).error).toContain(
      'Description is required',
    );
  });

  test('returns fail(422) when targets is invalid JSON', async () => {
    const result = await submitEdit({
      title: 'A title',
      description: 'A description',
      targets: 'not json',
      locationOptions: '[]',
    });
    expect(result?.status).toBe(422);
    expect((result?.data as { error: string }).error).toContain(
      'Invalid targets',
    );
  });

  test('returns fail(422) when locationOptions is invalid JSON', async () => {
    const result = await submitEdit({
      title: 'A title',
      description: 'A description',
      targets: '[]',
      locationOptions: 'not json',
    });
    expect(result?.status).toBe(422);
    expect((result?.data as { error: string }).error).toContain(
      'Invalid location options',
    );
  });

  test('returns fail(422) when geo coordinates are null', async () => {
    const result = await submitEdit({
      title: 'A title',
      description: 'A description',
      targets: '[]',
      locationOptions: JSON.stringify([
        {
          name: 'Bad Place',
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
    expect(result?.status).toBe(422);
  });

  test('calls putRecord with updated title, keeping original createdAt', async () => {
    await submitEdit({
      title: 'New Title',
      description: 'New Description',
      targets: '[]',
      locationOptions: '[]',
    });
    expect(putRecord).toHaveBeenCalledWith(
      DID,
      'bio.lexicons.temp.surveyProtocol',
      RKEY,
      expect.objectContaining({
        title: 'New Title',
        description: 'New Description',
        createdAt: FAKE_PROTOCOL.record.createdAt,
      }),
    );
  });
});
