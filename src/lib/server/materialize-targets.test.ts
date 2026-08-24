import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/pds', () => ({
  putRecord: vi.fn(),
  deleteRecord: vi.fn(),
}));

vi.mock('$lib/server/db/survey-protocols', () => ({
  getProtocolTargetsForProtocols: vi.fn(),
  getProtocolTargetStatusesByProtocol: vi.fn(),
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
import {
  getProtocolTargetStatusesByProtocol,
  getProtocolTargetsForProtocols,
} from '$lib/server/db/survey-protocols';
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
const PT_URI2 = 'at://did:test:author/bio.cuanto.protocolTarget/t2';
const PT_URI3 = 'at://did:test:author/bio.cuanto.protocolTarget/t3';
const ST_URI = `at://${DID}/bio.cuanto.surveyTarget/t1`;
const ST_URI2 = `at://${DID}/bio.cuanto.surveyTarget/t2`;
const ST_URI3 = `at://${DID}/bio.cuanto.surveyTarget/t3`;

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

// A surveyTarget already materialized for t2, still active (never retired).
function existingSurveyTarget(overrides: Record<string, unknown> = {}) {
  return {
    at_uri: ST_URI2,
    rkey: 't2',
    protocol_uri: PROTOCOL_URI,
    protocol_target_uri: PT_URI2,
    created_at: null,
    record: {
      $type: 'bio.cuanto.surveyTarget',
      protocol: PROTOCOL_URI,
      protocolTargetID: PT_URI2,
      createdAt: '2026-01-01T00:00:00.000Z',
      scope: [],
      ...overrides,
    },
  };
}

// The protocol_targets status row for rkey t2: live by default, or tombstoned
// when a deletedAt is given.
function targetStatus(rkey: string, deletedAt: Date | null = null) {
  return { rkey, deleted_at: deletedAt };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(putRecord).mockResolvedValue({ uri: ST_URI, cid: 'cid1' });
  vi.mocked(getProtocolTargetStatusesByProtocol).mockResolvedValue([]);
});

describe('materializeSurveyTargets', () => {
  test('creates a surveyTarget per protocolTarget, reusing the rkey', async () => {
    vi.mocked(getProtocolTargetsForProtocols).mockResolvedValue([
      protocolTargetRow,
    ] as unknown as Awaited<ReturnType<typeof getProtocolTargetsForProtocols>>);
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
    vi.mocked(getProtocolTargetsForProtocols).mockResolvedValue([
      protocolTargetRow,
    ] as unknown as Awaited<ReturnType<typeof getProtocolTargetsForProtocols>>);
    vi.mocked(getSurveyTargetsByDidAndProtocol).mockResolvedValue([
      {
        at_uri: ST_URI,
        rkey: 't1',
        protocol_uri: PROTOCOL_URI,
        protocol_target_uri: PT_URI,
        record: {
          $type: 'bio.cuanto.surveyTarget',
          protocol: PROTOCOL_URI,
          protocolTargetID: PT_URI,
          createdAt: '2026-01-01T00:00:00.000Z',
          scope: [],
        },
      },
    ] as unknown as Awaited<
      ReturnType<typeof getSurveyTargetsByDidAndProtocol>
    >);

    await materializeSurveyTargets(DID, PROTOCOL_URI);

    expect(putRecord).not.toHaveBeenCalled();
    expect(insertSurveyTarget).not.toHaveBeenCalled();
  });

  test('does nothing when the protocol has no targets and no existing surveyTargets', async () => {
    vi.mocked(getProtocolTargetsForProtocols).mockResolvedValue([]);
    vi.mocked(getSurveyTargetsByDidAndProtocol).mockResolvedValue([]);
    await materializeSurveyTargets(DID, PROTOCOL_URI);
    expect(putRecord).not.toHaveBeenCalled();
    expect(insertSurveyTarget).not.toHaveBeenCalled();
  });
});

// Issue #41: a deleted surveyTarget leaves a tombstoned index row behind. The
// row is what remembers the true adoption time across the gap, so recreating the
// record must carry that time forward rather than stamping "now" -- a fresh
// createdAt would retroactively suppress the notDetected rows of every survey
// conducted between the original adoption and the delete.
describe('materializeSurveyTargets: deletion recovery', () => {
  test('recreates a tombstoned surveyTarget with its original created_at', async () => {
    const adoptedAt = new Date('2026-01-01T00:00:00.000Z');
    const deletedAt = new Date('2026-06-01T00:00:00.000Z');

    vi.mocked(getProtocolTargetsForProtocols).mockResolvedValue([
      protocolTargetRow,
    ] as unknown as Awaited<ReturnType<typeof getProtocolTargetsForProtocols>>);
    vi.mocked(getSurveyTargetsByDidAndProtocol).mockResolvedValue([
      {
        at_uri: ST_URI,
        rkey: 't1',
        protocol_uri: PROTOCOL_URI,
        protocol_target_uri: PT_URI,
        created_at: adoptedAt,
        deleted_at: deletedAt,
        record: {
          $type: 'bio.cuanto.surveyTarget',
          protocol: PROTOCOL_URI,
          protocolTargetID: PT_URI,
          createdAt: adoptedAt.toISOString(),
          scope: [],
        },
      },
    ] as unknown as Awaited<
      ReturnType<typeof getSurveyTargetsByDidAndProtocol>
    >);

    await materializeSurveyTargets(DID, PROTOCOL_URI);

    expect(putRecord).toHaveBeenCalledWith(
      DID,
      'bio.cuanto.surveyTarget',
      't1',
      expect.objectContaining({
        protocolTargetID: PT_URI,
        createdAt: adoptedAt.toISOString(),
      }),
    );
    expect(insertSurveyTarget).toHaveBeenCalledWith(
      DID,
      't1',
      expect.objectContaining({ createdAt: adoptedAt.toISOString() }),
      ST_URI,
      PT_URI,
    );
  });

  test('leaves a live surveyTarget alone', async () => {
    vi.mocked(getProtocolTargetsForProtocols).mockResolvedValue([
      protocolTargetRow,
    ] as unknown as Awaited<ReturnType<typeof getProtocolTargetsForProtocols>>);
    vi.mocked(getSurveyTargetsByDidAndProtocol).mockResolvedValue([
      {
        at_uri: ST_URI,
        rkey: 't1',
        protocol_uri: PROTOCOL_URI,
        protocol_target_uri: PT_URI,
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        deleted_at: null,
        record: {
          $type: 'bio.cuanto.surveyTarget',
          protocol: PROTOCOL_URI,
          protocolTargetID: PT_URI,
          createdAt: '2026-01-01T00:00:00.000Z',
          scope: [],
        },
      },
    ] as unknown as Awaited<
      ReturnType<typeof getSurveyTargetsByDidAndProtocol>
    >);

    await materializeSurveyTargets(DID, PROTOCOL_URI);

    expect(putRecord).not.toHaveBeenCalled();
    expect(insertSurveyTarget).not.toHaveBeenCalled();
  });
});

describe('materializeSurveyTargets: retirement reconciliation', () => {
  test('retires a surveyTarget whose protocolTarget was tombstoned, stamping the true deletion time', async () => {
    vi.mocked(getProtocolTargetsForProtocols).mockResolvedValue([]);
    const deletedAt = new Date('2026-03-01T00:00:00.000Z');
    vi.mocked(getProtocolTargetStatusesByProtocol).mockResolvedValue([
      targetStatus('t2', deletedAt),
    ]);
    vi.mocked(getSurveyTargetsByDidAndProtocol).mockResolvedValue([
      existingSurveyTarget(),
    ] as unknown as Awaited<
      ReturnType<typeof getSurveyTargetsByDidAndProtocol>
    >);
    vi.mocked(putRecord).mockResolvedValue({ uri: ST_URI2, cid: 'cid2' });

    await materializeSurveyTargets(DID, PROTOCOL_URI);

    // retiredAt is the tombstone's deleted_at, not the reconciliation call's
    // own "now" -- closes the false-notDetected window between the author's
    // delete and the surveyor's next sync.
    expect(putRecord).toHaveBeenCalledWith(
      DID,
      'bio.cuanto.surveyTarget',
      't2',
      expect.objectContaining({
        protocolTargetID: PT_URI2,
        retiredAt: deletedAt.toISOString(),
      }),
    );
    expect(insertSurveyTarget).toHaveBeenCalledWith(
      DID,
      't2',
      expect.objectContaining({ retiredAt: deletedAt.toISOString() }),
      ST_URI2,
      PT_URI2,
    );
  });

  test('does not retire a surveyTarget whose protocolTarget is live', async () => {
    vi.mocked(getProtocolTargetsForProtocols).mockResolvedValue([
      { protocol_uri: PROTOCOL_URI, at_uri: PT_URI2, record: { scope: [] } },
    ] as unknown as Awaited<ReturnType<typeof getProtocolTargetsForProtocols>>);
    vi.mocked(getProtocolTargetStatusesByProtocol).mockResolvedValue([
      targetStatus('t2'),
    ]);
    vi.mocked(getSurveyTargetsByDidAndProtocol).mockResolvedValue([
      existingSurveyTarget(),
    ] as unknown as Awaited<
      ReturnType<typeof getSurveyTargetsByDidAndProtocol>
    >);

    await materializeSurveyTargets(DID, PROTOCOL_URI);

    expect(putRecord).not.toHaveBeenCalled();
    expect(insertSurveyTarget).not.toHaveBeenCalled();
  });

  test('un-retires a surveyTarget whose protocolTarget is live again under the same rkey', async () => {
    vi.mocked(getProtocolTargetsForProtocols).mockResolvedValue([
      { protocol_uri: PROTOCOL_URI, at_uri: PT_URI2, record: { scope: [] } },
    ] as unknown as Awaited<ReturnType<typeof getProtocolTargetsForProtocols>>);
    vi.mocked(getProtocolTargetStatusesByProtocol).mockResolvedValue([
      targetStatus('t2'),
    ]);
    vi.mocked(getSurveyTargetsByDidAndProtocol).mockResolvedValue([
      existingSurveyTarget({ retiredAt: '2026-02-01T00:00:00.000Z' }),
    ] as unknown as Awaited<
      ReturnType<typeof getSurveyTargetsByDidAndProtocol>
    >);
    vi.mocked(putRecord).mockResolvedValue({ uri: ST_URI2, cid: 'cid2' });

    await materializeSurveyTargets(DID, PROTOCOL_URI);

    expect(putRecord).toHaveBeenCalledWith(
      DID,
      'bio.cuanto.surveyTarget',
      't2',
      expect.not.objectContaining({ retiredAt: expect.anything() }),
    );
    expect(insertSurveyTarget).toHaveBeenCalledWith(
      DID,
      't2',
      expect.not.objectContaining({ retiredAt: expect.anything() }),
      ST_URI2,
      PT_URI2,
    );
  });

  test('is idempotent: does not re-stamp a surveyTarget that is already retired', async () => {
    vi.mocked(getProtocolTargetsForProtocols).mockResolvedValue([]);
    vi.mocked(getProtocolTargetStatusesByProtocol).mockResolvedValue([
      targetStatus('t2', new Date('2026-02-01T00:00:00.000Z')),
    ]);
    vi.mocked(getSurveyTargetsByDidAndProtocol).mockResolvedValue([
      existingSurveyTarget({ retiredAt: '2026-02-01T00:00:00.000Z' }),
    ] as unknown as Awaited<
      ReturnType<typeof getSurveyTargetsByDidAndProtocol>
    >);

    await materializeSurveyTargets(DID, PROTOCOL_URI);

    expect(putRecord).not.toHaveBeenCalled();
    expect(insertSurveyTarget).not.toHaveBeenCalled();
  });

  test('retires every existing target when the whole protocol is emptied (all protocolTargets tombstoned)', async () => {
    vi.mocked(getProtocolTargetsForProtocols).mockResolvedValue([]);
    const deletedAt = new Date('2026-03-01T00:00:00.000Z');
    vi.mocked(getProtocolTargetStatusesByProtocol).mockResolvedValue([
      targetStatus('t2', deletedAt),
      targetStatus('t3', deletedAt),
    ]);
    const other = {
      ...existingSurveyTarget(),
      at_uri: ST_URI3,
      rkey: 't3',
      protocol_target_uri: PT_URI3,
      record: { ...existingSurveyTarget().record, protocolTargetID: PT_URI3 },
    };
    vi.mocked(getSurveyTargetsByDidAndProtocol).mockResolvedValue([
      existingSurveyTarget(),
      other,
    ] as unknown as Awaited<
      ReturnType<typeof getSurveyTargetsByDidAndProtocol>
    >);

    await materializeSurveyTargets(DID, PROTOCOL_URI);

    // Previously a documented v1 limitation (whole-protocol deletion was
    // never retired because the guard bailed on the protocol itself being
    // gone); tombstones make every target's deletion independently visible,
    // so this now Just Works.
    expect(insertSurveyTarget).toHaveBeenCalledTimes(2);
    expect(putRecord).toHaveBeenCalledWith(
      DID,
      'bio.cuanto.surveyTarget',
      't2',
      expect.objectContaining({ retiredAt: deletedAt.toISOString() }),
    );
    expect(putRecord).toHaveBeenCalledWith(
      DID,
      'bio.cuanto.surveyTarget',
      't3',
      expect.objectContaining({ retiredAt: deletedAt.toISOString() }),
    );
  });

  test('does not touch a surveyTarget with no protocol_targets row at all (not indexed yet, or mid-backfill)', async () => {
    vi.mocked(getProtocolTargetsForProtocols).mockResolvedValue([]);
    vi.mocked(getProtocolTargetStatusesByProtocol).mockResolvedValue([]);
    vi.mocked(getSurveyTargetsByDidAndProtocol).mockResolvedValue([
      existingSurveyTarget(),
    ] as unknown as Awaited<
      ReturnType<typeof getSurveyTargetsByDidAndProtocol>
    >);

    await materializeSurveyTargets(DID, PROTOCOL_URI);

    expect(putRecord).not.toHaveBeenCalled();
    expect(insertSurveyTarget).not.toHaveBeenCalled();
  });

  test('a PDS failure retiring one target does not throw and does not block reconciling the rest', async () => {
    vi.mocked(getProtocolTargetsForProtocols).mockResolvedValue([]);
    const deletedAt = new Date('2026-03-01T00:00:00.000Z');
    vi.mocked(getProtocolTargetStatusesByProtocol).mockResolvedValue([
      targetStatus('t2', deletedAt),
      targetStatus('t3', deletedAt),
    ]);
    const failingTarget = existingSurveyTarget();
    const okTarget = {
      ...existingSurveyTarget(),
      at_uri: ST_URI3,
      rkey: 't3',
      protocol_target_uri: PT_URI3,
      record: {
        ...existingSurveyTarget().record,
        protocolTargetID: PT_URI3,
      },
    };
    vi.mocked(getSurveyTargetsByDidAndProtocol).mockResolvedValue([
      failingTarget,
      okTarget,
    ] as unknown as Awaited<
      ReturnType<typeof getSurveyTargetsByDidAndProtocol>
    >);
    vi.mocked(putRecord)
      .mockRejectedValueOnce(new Error('PDS unavailable'))
      .mockResolvedValueOnce({ uri: ST_URI3, cid: 'cid3' });

    await expect(
      materializeSurveyTargets(DID, PROTOCOL_URI),
    ).resolves.toBeUndefined();

    expect(putRecord).toHaveBeenCalledTimes(2);
    expect(insertSurveyTarget).toHaveBeenCalledTimes(1);
    expect(insertSurveyTarget).toHaveBeenCalledWith(
      DID,
      't3',
      expect.anything(),
      ST_URI3,
      PT_URI3,
    );
  });

  test('falls back to the created_at column when retiring a legacy target with no record.createdAt', async () => {
    vi.mocked(getProtocolTargetsForProtocols).mockResolvedValue([]);
    vi.mocked(getProtocolTargetStatusesByProtocol).mockResolvedValue([
      targetStatus('t2', new Date('2026-03-01T00:00:00.000Z')),
    ]);
    const legacyTarget = {
      ...existingSurveyTarget(),
      created_at: new Date('2026-01-05T00:00:00.000Z'),
      record: {
        ...existingSurveyTarget().record,
        createdAt: undefined,
      },
    };
    vi.mocked(getSurveyTargetsByDidAndProtocol).mockResolvedValue([
      legacyTarget,
    ] as unknown as Awaited<
      ReturnType<typeof getSurveyTargetsByDidAndProtocol>
    >);

    await materializeSurveyTargets(DID, PROTOCOL_URI);

    expect(putRecord).toHaveBeenCalledWith(
      DID,
      'bio.cuanto.surveyTarget',
      't2',
      expect.objectContaining({ createdAt: '2026-01-05T00:00:00.000Z' }),
    );
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
