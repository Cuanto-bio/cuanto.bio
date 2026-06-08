import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/pds', () => ({
  putRecord: vi.fn(),
  deleteRecord: vi.fn(),
}));

vi.mock('$lib/server/db/survey-protocols', () => ({
  getTargetsForProtocols: vi.fn(),
}));

vi.mock('$lib/server/db/survey-targets', () => ({
  getSurveyTargetsByDidAndProtocol: vi.fn(),
  insertSurveyTarget: vi.fn(),
  deleteSurveyTargetsByDidAndProtocol: vi.fn(),
}));

vi.mock('$lib/server/db/surveys', () => ({
  countSurveysByDidAndProtocol: vi.fn(),
}));

vi.mock('$lib/server/db/protocol-follows', () => ({
  getFollowByDidAndProtocol: vi.fn(),
}));

vi.mock('$lib/server/logger', () => ({
  default: { child: () => ({ info: vi.fn(), error: vi.fn() }) },
}));

import { getFollowByDidAndProtocol } from '$lib/server/db/protocol-follows';
import { getTargetsForProtocols } from '$lib/server/db/survey-protocols';
import {
  deleteSurveyTargetsByDidAndProtocol,
  getSurveyTargetsByDidAndProtocol,
  insertSurveyTarget,
} from '$lib/server/db/survey-targets';
import { countSurveysByDidAndProtocol } from '$lib/server/db/surveys';
import { deleteRecord, putRecord } from '$lib/server/pds';
import {
  gcSurveyTargetsIfUnused,
  materializeSurveyTargets,
} from './materialize-targets';

const DID = 'did:test:surveyor';
const PROTOCOL_URI = 'at://did:test:author/bio.cuanto.surveyProtocol/proto1';
const PT_URI = 'at://did:test:author/bio.cuanto.protocolTarget/t1';
const ST_URI = `at://${DID}/bio.cuanto.surveyTarget/t1`;

const protocolTargetRow = {
  protocol_uri: PROTOCOL_URI,
  at_uri: PT_URI,
  record: {
    $type: 'bio.cuanto.protocolTarget',
    protocol: PROTOCOL_URI,
    scope: [
      {
        $type: 'bio.cuanto.protocolTarget#taxonScope',
        scientificName: 'Quercus',
        taxonRank: 'genus',
      },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(putRecord).mockResolvedValue({ uri: ST_URI, cid: 'cid1' });
});

describe('materializeSurveyTargets', () => {
  test('creates a surveyTarget per protocolTarget, reusing the rkey', async () => {
    vi.mocked(getTargetsForProtocols).mockResolvedValue([
      protocolTargetRow,
    ] as unknown as Awaited<ReturnType<typeof getTargetsForProtocols>>);
    vi.mocked(getSurveyTargetsByDidAndProtocol).mockResolvedValue([]);

    await materializeSurveyTargets(DID, PROTOCOL_URI);

    expect(putRecord).toHaveBeenCalledWith(
      DID,
      'bio.cuanto.surveyTarget',
      't1',
      expect.objectContaining({
        protocol: PROTOCOL_URI,
        protocolTargetID: PT_URI,
      }),
    );
    expect(insertSurveyTarget).toHaveBeenCalledWith(
      DID,
      't1',
      expect.anything(),
      ST_URI,
      PT_URI,
    );
  });

  test('is idempotent: skips targets already materialized', async () => {
    vi.mocked(getTargetsForProtocols).mockResolvedValue([
      protocolTargetRow,
    ] as unknown as Awaited<ReturnType<typeof getTargetsForProtocols>>);
    vi.mocked(getSurveyTargetsByDidAndProtocol).mockResolvedValue([
      { rkey: 't1' },
    ] as unknown as Awaited<
      ReturnType<typeof getSurveyTargetsByDidAndProtocol>
    >);

    await materializeSurveyTargets(DID, PROTOCOL_URI);

    expect(putRecord).not.toHaveBeenCalled();
    expect(insertSurveyTarget).not.toHaveBeenCalled();
  });

  test('does nothing when the protocol has no targets', async () => {
    vi.mocked(getTargetsForProtocols).mockResolvedValue([]);
    await materializeSurveyTargets(DID, PROTOCOL_URI);
    expect(getSurveyTargetsByDidAndProtocol).not.toHaveBeenCalled();
    expect(putRecord).not.toHaveBeenCalled();
  });
});

describe('gcSurveyTargetsIfUnused', () => {
  test('deletes surveyTargets when not following and no surveys remain', async () => {
    vi.mocked(getFollowByDidAndProtocol).mockResolvedValue(null);
    vi.mocked(countSurveysByDidAndProtocol).mockResolvedValue(0);
    vi.mocked(deleteSurveyTargetsByDidAndProtocol).mockResolvedValue([ST_URI]);

    await gcSurveyTargetsIfUnused(DID, PROTOCOL_URI);

    expect(deleteSurveyTargetsByDidAndProtocol).toHaveBeenCalledWith(
      DID,
      PROTOCOL_URI,
    );
    expect(deleteRecord).toHaveBeenCalledWith(ST_URI);
  });

  test('keeps surveyTargets while still following', async () => {
    vi.mocked(getFollowByDidAndProtocol).mockResolvedValue({
      at_uri: 'at://x',
    } as unknown as Awaited<ReturnType<typeof getFollowByDidAndProtocol>>);
    vi.mocked(countSurveysByDidAndProtocol).mockResolvedValue(0);

    await gcSurveyTargetsIfUnused(DID, PROTOCOL_URI);

    expect(deleteSurveyTargetsByDidAndProtocol).not.toHaveBeenCalled();
    expect(deleteRecord).not.toHaveBeenCalled();
  });

  test('keeps surveyTargets while surveys still exist (sought-but-not-found preserved)', async () => {
    vi.mocked(getFollowByDidAndProtocol).mockResolvedValue(null);
    vi.mocked(countSurveysByDidAndProtocol).mockResolvedValue(2);

    await gcSurveyTargetsIfUnused(DID, PROTOCOL_URI);

    expect(deleteSurveyTargetsByDidAndProtocol).not.toHaveBeenCalled();
  });
});
