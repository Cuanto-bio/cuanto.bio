import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/pds', () => {
  class PdsSessionExpiredError extends Error {
    constructor() {
      super('AT Protocol session expired. Please sign in again.');
    }
  }
  class PdsScopeInsufficientError extends PdsSessionExpiredError {}
  return {
    putRecord: vi.fn(),
    deleteRecord: vi.fn(),
    createRecord: vi.fn(),
    PdsSessionExpiredError,
    PdsScopeInsufficientError,
  };
});

vi.mock('$lib/server/db/survey-protocols', () => ({
  getProtocolDetailByHandleAndRkey: vi.fn(),
  insertProtocol: vi.fn(),
  insertProtocolTarget: vi.fn(),
  tombstoneProtocolTargetsByUris: vi.fn().mockResolvedValue(undefined),
  tombstoneProtocolByUri: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/server/db/protocol-follows', () => ({
  getFollowByDidAndProtocol: vi.fn().mockResolvedValue(null),
  deleteFollow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/server/db/surveys', () => ({
  countSurveysByProtocolUri: vi.fn().mockResolvedValue(0),
}));

vi.mock('$lib/server/db', () => ({
  default: vi.fn().mockResolvedValue([{ did: 'did:test:protocols-edit-spec' }]),
}));

vi.mock('$lib/logger', () => ({
  default: {
    child: vi.fn().mockReturnValue({ error: vi.fn(), info: vi.fn() }),
  },
}));

import {
  deleteFollow,
  getFollowByDidAndProtocol,
} from '$lib/server/db/protocol-follows';
import {
  getProtocolDetailByHandleAndRkey,
  tombstoneProtocolByUri,
  tombstoneProtocolTargetsByUris,
} from '$lib/server/db/survey-protocols';
import {
  createRecord,
  deleteRecord,
  PdsScopeInsufficientError,
  PdsSessionExpiredError,
  putRecord,
} from '$lib/server/pds';
import { actions, load } from './+page.server';

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
    return await (actions as Record<string, Function>).save({
      request: makeFormRequest(fields),
      locals: { did: DID },
      params: { handle: HANDLE, rkey: RKEY },
    });
  } catch {
    return null;
  }
}

async function submitDelete() {
  try {
    // biome-ignore lint/complexity/noBannedTypes: ok for test
    return await (actions as Record<string, Function>).delete({
      request: makeFormRequest({}),
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

describe('POST /protocols/[handle]/[rkey]/edit — PDS session expiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProtocolDetailByHandleAndRkey).mockResolvedValue(
      FAKE_PROTOCOL as never,
    );
  });

  test('returns fail(401) with sessionExpired when putRecord throws PdsSessionExpiredError', async () => {
    vi.mocked(putRecord).mockRejectedValueOnce(new PdsSessionExpiredError());

    const result = await submitEdit({
      title: 'New Title',
      description: 'New Description',
      targets: '[]',
      locationOptions: '[]',
    });

    expect(result?.status).toBe(401);
    expect((result?.data as { sessionExpired?: boolean }).sessionExpired).toBe(
      true,
    );
  });

  test('returns fail(403) with permissionRequired when putRecord throws PdsScopeInsufficientError', async () => {
    vi.mocked(putRecord).mockRejectedValueOnce(new PdsScopeInsufficientError());

    const result = await submitEdit({
      title: 'New Title',
      description: 'New Description',
      targets: '[]',
      locationOptions: '[]',
    });

    expect(result?.status).toBe(403);
    expect(
      (result?.data as { permissionRequired?: boolean }).permissionRequired,
    ).toBe(true);
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

// Regression for issue #72: a target write failure was caught, logged, and
// then ignored — the action still redirected as if the whole edit succeeded,
// so a surveyor who lost a target (e.g. to a PDS scope error) was never told.
describe('POST /protocols/[handle]/[rkey]/edit — target write failures', () => {
  const PROTOCOL_URI = `at://${DID}/bio.cuanto.surveyProtocol/${RKEY}`;
  const NEW_TARGET_SCOPE = [
    {
      $type: 'bio.cuanto.protocolTarget#verbatimScope',
      verbatimTargetScope: 'New target',
    },
  ];
  const TARGET_A = {
    atUri: `at://${DID}/bio.cuanto.protocolTarget/targetA`,
    record: {
      $type: 'bio.cuanto.protocolTarget',
      protocol: PROTOCOL_URI,
      scope: [
        {
          $type: 'bio.cuanto.protocolTarget#verbatimScope',
          verbatimTargetScope: 'Existing target',
        },
      ],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProtocolDetailByHandleAndRkey).mockResolvedValue({
      ...FAKE_PROTOCOL,
      targets: [TARGET_A],
    } as never);
  });

  test('does not redirect (report success) when creating a target fails', async () => {
    vi.mocked(putRecord).mockResolvedValue({
      uri: FAKE_PROTOCOL.atUri,
      cid: FAKE_CID,
    });
    vi.mocked(createRecord).mockRejectedValueOnce(new Error('boom'));

    const result = await submitEdit({
      title: 'Title',
      description: 'Description',
      targets: JSON.stringify([
        { scope: TARGET_A.record.scope, atUri: TARGET_A.atUri },
        { scope: NEW_TARGET_SCOPE },
      ]),
      locationOptions: '[]',
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe(502);
  });

  test('returns fail(403) with permissionRequired when creating a target throws PdsScopeInsufficientError', async () => {
    vi.mocked(putRecord).mockResolvedValue({
      uri: FAKE_PROTOCOL.atUri,
      cid: FAKE_CID,
    });
    vi.mocked(createRecord).mockRejectedValueOnce(
      new PdsScopeInsufficientError(),
    );

    const result = await submitEdit({
      title: 'Title',
      description: 'Description',
      targets: JSON.stringify([{ scope: NEW_TARGET_SCOPE }]),
      locationOptions: '[]',
    });

    expect(result?.status).toBe(403);
    expect(
      (result?.data as { permissionRequired?: boolean }).permissionRequired,
    ).toBe(true);
  });

  test('does not redirect (report success) when updating a target fails', async () => {
    vi.mocked(putRecord)
      .mockResolvedValueOnce({ uri: FAKE_PROTOCOL.atUri, cid: FAKE_CID }) // protocol write
      .mockRejectedValueOnce(new Error('boom')); // target update write

    const updatedScope = [
      { ...TARGET_A.record.scope[0], verbatimTargetScope: 'Changed' },
    ];
    const result = await submitEdit({
      title: 'Title',
      description: 'Description',
      targets: JSON.stringify([{ scope: updatedScope, atUri: TARGET_A.atUri }]),
      locationOptions: '[]',
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe(502);
  });

  test('does not redirect (report success) when deleting a target fails', async () => {
    vi.mocked(putRecord).mockResolvedValue({
      uri: FAKE_PROTOCOL.atUri,
      cid: FAKE_CID,
    });
    vi.mocked(deleteRecord).mockRejectedValueOnce(new Error('boom'));

    // Submitting with no targets means TARGET_A gets deleted.
    const result = await submitEdit({
      title: 'Title',
      description: 'Description',
      targets: '[]',
      locationOptions: '[]',
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe(502);
  });
});

// Regression coverage for issue #25: surveys.protocol_uri and occurrences
// (via surveys) reach survey_protocols through ON DELETE CASCADE foreign
// keys, so the delete action must tombstone rather than hard-delete — these
// tests can't see the DB directly (survey-protocols is mocked), but they can
// pin down that the action calls the tombstone helpers, never anything that
// hard-deletes a row.
describe('POST /protocols/[handle]/[rkey]/edit?/delete', () => {
  const PROTOCOL_URI = `at://${DID}/bio.cuanto.surveyProtocol/${RKEY}`;
  const TARGET_A = {
    atUri: `at://${DID}/bio.cuanto.protocolTarget/targetA`,
    record: {
      $type: 'bio.cuanto.protocolTarget',
      protocol: PROTOCOL_URI,
      scope: [
        {
          $type: 'bio.cuanto.protocolTarget#verbatimScope',
          verbatimTargetScope: 'Existing target',
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
          $type: 'bio.cuanto.protocolTarget#verbatimScope',
          verbatimTargetScope: 'Another target',
        },
      ],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProtocolDetailByHandleAndRkey).mockResolvedValue({
      ...FAKE_PROTOCOL,
      targets: [TARGET_A, TARGET_B],
    } as never);
    vi.mocked(getFollowByDidAndProtocol).mockResolvedValue(null);
  });

  test('tombstones the protocol and every target, deletes their PDS records in target-then-protocol order, and redirects', async () => {
    const result = await submitDelete();

    expect(result).toBeNull(); // redirect() throws, caught by the test helper
    // Batched, one call for every target actually deleted from the PDS, not
    // one call per target (see the failure-path tests below for why the
    // batch has to wait until each PDS delete is confirmed).
    expect(tombstoneProtocolTargetsByUris).toHaveBeenCalledWith([
      TARGET_A.atUri,
      TARGET_B.atUri,
    ]);
    expect(tombstoneProtocolByUri).toHaveBeenCalledWith(FAKE_PROTOCOL.atUri);

    const deletedUris = vi.mocked(deleteRecord).mock.calls.map((c) => c[0]);
    expect(deletedUris).toEqual([
      TARGET_A.atUri,
      TARGET_B.atUri,
      FAKE_PROTOCOL.atUri,
    ]);

    // Tombstoning must trail its own PDS delete, not race ahead of it: a
    // target that isn't yet confirmed gone from the PDS still needs to show
    // up in a retry's live-target list.
    const targetsCallOrder = vi.mocked(tombstoneProtocolTargetsByUris).mock
      .invocationCallOrder[0];
    const targetBDeleteOrder = vi
      .mocked(deleteRecord)
      .mock.calls.findIndex((c) => c[0] === TARGET_B.atUri);
    expect(targetBDeleteOrder).toBeGreaterThanOrEqual(0);
    expect(
      vi.mocked(deleteRecord).mock.invocationCallOrder[targetBDeleteOrder],
    ).toBeLessThan(targetsCallOrder);

    const protocolCallOrder = vi.mocked(tombstoneProtocolByUri).mock
      .invocationCallOrder[0];
    const protocolDeleteOrder = vi
      .mocked(deleteRecord)
      .mock.calls.findIndex((c) => c[0] === FAKE_PROTOCOL.atUri);
    expect(
      vi.mocked(deleteRecord).mock.invocationCallOrder[protocolDeleteOrder],
    ).toBeLessThan(protocolCallOrder);
  });

  test('does not tombstone a target whose PDS delete failed, but keeps the tombstone for one already confirmed deleted', async () => {
    // Chained Once calls, not mockImplementation: this file's beforeEach only
    // clearAllMocks (call history), not resetAllMocks, so an unconditional
    // mockImplementation here would leak into every later test in this
    // describe block.
    vi.mocked(deleteRecord)
      .mockResolvedValueOnce(undefined) // target A
      .mockRejectedValueOnce(new Error('boom')); // target B

    const result = await submitDelete();

    expect(result?.status).toBe(502);
    expect(tombstoneProtocolTargetsByUris).toHaveBeenCalledWith([
      TARGET_A.atUri,
    ]);
    expect(tombstoneProtocolByUri).not.toHaveBeenCalled();
  });

  test('does not tombstone the protocol when its own PDS delete fails, even though every target succeeded', async () => {
    vi.mocked(deleteRecord)
      .mockResolvedValueOnce(undefined) // target A
      .mockResolvedValueOnce(undefined) // target B
      .mockRejectedValueOnce(new Error('boom')); // protocol itself

    const result = await submitDelete();

    expect(result?.status).toBe(502);
    expect(tombstoneProtocolTargetsByUris).toHaveBeenCalledWith([
      TARGET_A.atUri,
      TARGET_B.atUri,
    ]);
    expect(tombstoneProtocolByUri).not.toHaveBeenCalled();
  });

  test("best-effort deletes the author's own follow record after the protocol is gone", async () => {
    const followUri = `at://${DID}/bio.cuanto.surveyProtocol.follow/self`;
    vi.mocked(getFollowByDidAndProtocol).mockResolvedValue({
      at_uri: followUri,
    } as never);

    await submitDelete();

    expect(getFollowByDidAndProtocol).toHaveBeenCalledWith(
      DID,
      FAKE_PROTOCOL.atUri,
    );
    expect(deleteRecord).toHaveBeenCalledWith(followUri);
    expect(deleteFollow).toHaveBeenCalledWith(followUri);
  });

  test('does not look up a follow to delete when the author never followed their own protocol', async () => {
    await submitDelete();
    expect(deleteFollow).not.toHaveBeenCalled();
  });

  test('still redirects (protocol delete already succeeded) when deleting the own follow record fails', async () => {
    vi.mocked(getFollowByDidAndProtocol).mockResolvedValue({
      at_uri: `at://${DID}/bio.cuanto.surveyProtocol.follow/self`,
    } as never);
    vi.mocked(deleteRecord).mockImplementation(async (uri: string) => {
      if (uri.includes('surveyProtocol.follow')) throw new Error('boom');
    });

    const result = await submitDelete();
    expect(result).toBeNull(); // still redirected
  });

  test('returns fail(502) and does not delete the protocol when deleting a target fails', async () => {
    vi.mocked(deleteRecord).mockRejectedValueOnce(new Error('boom'));

    const result = await submitDelete();

    expect(result?.status).toBe(502);
    expect(deleteRecord).not.toHaveBeenCalledWith(FAKE_PROTOCOL.atUri);
    // The very first target failed, so nothing was actually confirmed
    // deleted from the PDS yet — there's nothing to tombstone.
    expect(tombstoneProtocolTargetsByUris).not.toHaveBeenCalled();
    expect(tombstoneProtocolByUri).not.toHaveBeenCalled();
  });

  test('returns fail(403) with permissionRequired when deleting a target throws PdsScopeInsufficientError', async () => {
    vi.mocked(deleteRecord).mockRejectedValueOnce(
      new PdsScopeInsufficientError(),
    );

    const result = await submitDelete();

    expect(result?.status).toBe(403);
    expect(
      (result?.data as { permissionRequired?: boolean }).permissionRequired,
    ).toBe(true);
  });

  test('returns fail(401) with sessionExpired when deleting the protocol itself throws PdsSessionExpiredError', async () => {
    vi.mocked(deleteRecord).mockImplementation(async (uri: string) => {
      if (uri === FAKE_PROTOCOL.atUri) throw new PdsSessionExpiredError();
    });

    const result = await submitDelete();

    expect(result?.status).toBe(401);
    expect((result?.data as { sessionExpired?: boolean }).sessionExpired).toBe(
      true,
    );
  });
});

describe('GET /protocols/[handle]/[rkey]/edit — signed out', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('redirects to sign-in carrying this page as returnTo', async () => {
    // Without returnTo the visitor signs in and lands somewhere else, having
    // lost the edit they set out to make. The native shell needs it most: its
    // sign-in is a system-browser round trip, so the destination has to
    // survive the trip in the URL rather than in component state.
    let thrown: unknown;
    try {
      await load({
        locals: {},
        params: { handle: HANDLE, rkey: RKEY },
      } as unknown as Parameters<typeof load>[0]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({
      status: 302,
      location: `/auth/signin?returnTo=${encodeURIComponent(
        `/protocols/${HANDLE}/${RKEY}/edit`,
      )}`,
    });
  });
});
