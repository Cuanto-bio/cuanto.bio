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
  deleteTargetsByUris: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/server/db', () => ({
  default: vi.fn().mockResolvedValue([{ did: 'did:test:protocols-edit-spec' }]),
}));

vi.mock('$lib/logger', () => ({
  default: { child: vi.fn().mockReturnValue({ error: vi.fn() }) },
}));

import { getProtocolDetailByHandleAndRkey } from '$lib/server/db/survey-protocols';
import { createRecord, deleteRecord, putRecord } from '$lib/server/pds';
import { actions } from './+page.server';

const FAKE_CID = 'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34';
const DID = 'did:test:protocols-edit-spec';
const HANDLE = 'user-edit-unit-spec';
const RKEY = 'testrkey';

const FAKE_PROTOCOL = {
  atUri: `at://${DID}/bio.cuanto.surveyProtocol/${RKEY}`,
  rkey: RKEY,
  handle: HANDLE,
  record: {
    $type: 'bio.cuanto.surveyProtocol',
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
      'bio.cuanto.surveyProtocol',
      RKEY,
      expect.objectContaining({
        title: 'New Title',
        description: 'New Description',
        createdAt: FAKE_PROTOCOL.record.createdAt,
      }),
    );
  });
});

describe('POST /protocols/[handle]/[rkey]/edit — target management', () => {
  const PROTOCOL_URI = `at://${DID}/bio.cuanto.surveyProtocol/${RKEY}`;
  const TARGET_A = {
    atUri: `at://${DID}/bio.cuanto.protocolTarget/targetA`,
    record: {
      $type: 'bio.cuanto.protocolTarget',
      protocol: PROTOCOL_URI,
      scope: [
        {
          $type: 'bio.cuanto.protocolTarget#taxonScope',
          taxonID: 'https://www.inaturalist.org/taxa/1',
          scientificName: 'Species A',
          taxonRank: 'species',
        },
      ],
    },
  };
  const TARGET_B = {
    atUri: `at://${DID}/bio.cuanto.protocolTarget/targetB`,
    record: {
      $type: 'bio.cuanto.protocolTarget',
      protocol: PROTOCOL_URI,
      scope: [
        {
          $type: 'bio.cuanto.protocolTarget#taxonScope',
          taxonID: 'https://www.inaturalist.org/taxa/2',
          scientificName: 'Species B',
          taxonRank: 'species',
        },
      ],
    },
  };
  const SCOPE_C = [
    {
      $type: 'bio.cuanto.protocolTarget#taxonScope',
      taxonID: 'https://www.inaturalist.org/taxa/3',
      scientificName: 'Species C',
      taxonRank: 'species',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProtocolDetailByHandleAndRkey).mockResolvedValue({
      ...FAKE_PROTOCOL,
      targets: [TARGET_A, TARGET_B],
    } as never);
    vi.mocked(putRecord).mockResolvedValue({
      uri: FAKE_PROTOCOL.atUri,
      cid: FAKE_CID,
    });
    vi.mocked(createRecord).mockResolvedValue({
      uri: `at://${DID}/bio.cuanto.protocolTarget/newC`,
      cid: FAKE_CID,
    });
  });

  // Submits Target A (existing, with URI) + Target C (new, no URI); omits Target B → delete
  async function submitWithAandC() {
    return submitEdit({
      title: 'Title',
      description: 'Description',
      targets: JSON.stringify([
        { scope: TARGET_A.record.scope, atUri: TARGET_A.atUri },
        { scope: SCOPE_C },
      ]),
      locationOptions: '[]',
    });
  }

  test('does not delete a target submitted with its URI', async () => {
    await submitWithAandC();
    expect(deleteRecord).not.toHaveBeenCalledWith(TARGET_A.atUri);
  });

  test('deletes an existing target whose URI was not submitted', async () => {
    await submitWithAandC();
    expect(deleteRecord).toHaveBeenCalledWith(TARGET_B.atUri);
  });

  test('does not create a target submitted with an existing URI', async () => {
    await submitWithAandC();
    expect(createRecord).not.toHaveBeenCalledWith(
      DID,
      'bio.cuanto.protocolTarget',
      expect.objectContaining({ scope: TARGET_A.record.scope }),
    );
  });

  test('creates a target submitted without a URI', async () => {
    await submitWithAandC();
    expect(createRecord).toHaveBeenCalledWith(
      DID,
      'bio.cuanto.protocolTarget',
      expect.objectContaining({ scope: SCOPE_C }),
    );
  });

  test('does not call putRecord or createRecord for an unchanged existing target', async () => {
    await submitEdit({
      title: 'Title',
      description: 'Description',
      targets: JSON.stringify([
        { scope: TARGET_A.record.scope, atUri: TARGET_A.atUri },
        { scope: TARGET_B.record.scope, atUri: TARGET_B.atUri },
      ]),
      locationOptions: '[]',
    });
    expect(createRecord).not.toHaveBeenCalledWith(
      DID,
      'bio.cuanto.protocolTarget',
      expect.anything(),
    );
    expect(putRecord).not.toHaveBeenCalledWith(
      DID,
      'bio.cuanto.protocolTarget',
      expect.anything(),
      expect.anything(),
    );
  });

  test('updates a verbatim target in place when its text changes', async () => {
    const TARGET_V = {
      atUri: `at://${DID}/bio.cuanto.protocolTarget/targetV`,
      record: {
        $type: 'bio.cuanto.protocolTarget',
        protocol: PROTOCOL_URI,
        scope: [
          {
            $type: 'bio.cuanto.protocolTarget#verbatimScope',
            verbatimTargetScope: 'Old text',
          },
        ],
      },
    };
    vi.mocked(getProtocolDetailByHandleAndRkey).mockResolvedValue({
      ...FAKE_PROTOCOL,
      targets: [TARGET_V],
    } as never);
    const updatedScope = [
      { ...TARGET_V.record.scope[0], verbatimTargetScope: 'New text' },
    ];
    await submitEdit({
      title: 'Title',
      description: 'Description',
      targets: JSON.stringify([{ scope: updatedScope, atUri: TARGET_V.atUri }]),
      locationOptions: '[]',
    });
    expect(putRecord).toHaveBeenCalledWith(
      DID,
      'bio.cuanto.protocolTarget',
      TARGET_V.atUri.split('/').at(-1),
      expect.objectContaining({
        scope: expect.arrayContaining([
          expect.objectContaining({ verbatimTargetScope: 'New text' }),
        ]),
      }),
    );
    expect(deleteRecord).not.toHaveBeenCalledWith(TARGET_V.atUri);
    expect(createRecord).not.toHaveBeenCalledWith(
      DID,
      'bio.cuanto.protocolTarget',
      expect.objectContaining({ scope: updatedScope }),
    );
  });

  test('updates an existing target in place when its scope changes', async () => {
    const updatedScopeA = [
      { ...TARGET_A.record.scope[0], vernacularName: 'Common A' },
    ];
    await submitEdit({
      title: 'Title',
      description: 'Description',
      targets: JSON.stringify([
        { scope: updatedScopeA, atUri: TARGET_A.atUri },
        { scope: TARGET_B.record.scope, atUri: TARGET_B.atUri },
      ]),
      locationOptions: '[]',
    });
    expect(createRecord).not.toHaveBeenCalledWith(
      DID,
      'bio.cuanto.protocolTarget',
      expect.objectContaining({ scope: updatedScopeA }),
    );
    expect(putRecord).toHaveBeenCalledWith(
      DID,
      'bio.cuanto.protocolTarget',
      TARGET_A.atUri.split('/').at(-1),
      expect.objectContaining({
        scope: expect.arrayContaining([
          expect.objectContaining({ vernacularName: 'Common A' }),
        ]),
      }),
    );
    expect(deleteRecord).not.toHaveBeenCalledWith(TARGET_A.atUri);
  });
});
