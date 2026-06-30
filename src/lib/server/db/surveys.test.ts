import type { l } from '@atproto/lex';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/db', () => {
  const tag = Object.assign(
    vi.fn(() => Promise.resolve([])),
    {
      json: (v: unknown) => v,
      array: (v: unknown) => v,
    },
  );
  return { default: tag };
});

import sql from '$lib/server/db';
import {
  getLastSurveyByTargetUris,
  insertOccurrence,
  insertSurvey,
  type LastSurveyRow,
  parseCoords,
  toLastSurveyMap,
} from './surveys';

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ── parseCoords ──────────────────────────────────────────────────────────────

describe('parseCoords', () => {
  test('returns lat/lon for valid numeric strings', () => {
    expect(parseCoords('34.05', '-118.24')).toEqual({
      lat: 34.05,
      lon: -118.24,
    });
  });

  test('returns null when both are absent', () => {
    expect(parseCoords(undefined, undefined)).toBeNull();
  });

  test('returns null when only one is present', () => {
    expect(parseCoords('34.05', undefined)).toBeNull();
    expect(parseCoords(undefined, '-118.24')).toBeNull();
  });

  test('returns null for non-numeric strings', () => {
    expect(parseCoords('not-a-number', '-118.24')).toBeNull();
    expect(parseCoords('34.05', 'not-a-number')).toBeNull();
  });

  test('returns null for empty strings', () => {
    expect(parseCoords('', '-118.24')).toBeNull();
    expect(parseCoords('34.05', '')).toBeNull();
  });
});

// ── insertSurvey ─────────────────────────────────────────────────────────────

const baseSurveyRecord = {
  $type: 'bio.cuanto.survey' as const,
  protocol: {
    uri: 'at://did:plc:abc/bio.cuanto.surveyProtocol/3abc' as l.AtUriString,
    cid: 'bafycid' as l.CidString,
  },
  createdAt: '2026-04-13T10:00:00.000Z' as l.DatetimeString,
  eventDate: '2026-04-13T10:00:00.000Z',
  eventDurationValue: 30,
  eventDurationUnit: 'minutes',
  location: { $type: 'org.atgeo.place' as const, name: 'Test Park' },
};

describe('insertSurvey', () => {
  test('calls sql twice (geom fragment + INSERT) when location has no coordinates', async () => {
    await insertSurvey(
      'did:plc:abc',
      '3xyz',
      baseSurveyRecord,
      'at://did:plc:abc/bio.cuanto.survey/3xyz',
    );
    // Two calls: NULL geom fragment + INSERT
    expect(mockSql).toHaveBeenCalledTimes(2);
  });

  test('calls sql with ST_MakePoint geom fragment when location has coordinates', async () => {
    const record = {
      ...baseSurveyRecord,
      location: {
        $type: 'org.atgeo.place' as const,
        name: 'Test Park',
        locations: [
          {
            $type: 'community.lexicon.location.geo' as const,
            latitude: '37.7',
            longitude: '-122.4',
          },
        ],
      },
    };
    await insertSurvey(
      'did:plc:abc',
      '3xyz',
      record,
      'at://did:plc:abc/bio.cuanto.survey/3xyz',
    );
    expect(mockSql).toHaveBeenCalledTimes(2);
    const [firstCallStrings] = mockSql.mock.calls[0] as [TemplateStringsArray];
    expect(firstCallStrings.join('')).toContain('ST_MakePoint');
  });

  test('handles missing eventDate gracefully', async () => {
    const record = { ...baseSurveyRecord, eventDate: undefined };
    await expect(
      insertSurvey(
        'did:plc:abc',
        '3xyz',
        record,
        'at://did:plc:abc/bio.cuanto.survey/3xyz',
      ),
    ).resolves.toBeUndefined();
    expect(mockSql).toHaveBeenCalledTimes(2);
  });

  test('handles unparseable eventDate gracefully', async () => {
    const record = { ...baseSurveyRecord, eventDate: 'not-a-date' };
    await expect(
      insertSurvey(
        'did:plc:abc',
        '3xyz',
        record,
        'at://did:plc:abc/bio.cuanto.survey/3xyz',
      ),
    ).resolves.toBeUndefined();
    expect(mockSql).toHaveBeenCalledTimes(2);
  });
});

// ── insertOccurrence ─────────────────────────────────────────────────────────

const baseOccurrenceRecord = {
  $type: 'bio.lexicons.temp.v0-1.occurrence' as const,
  eventID: 'at://did:plc:abc/bio.cuanto.survey/3xyz' as l.AtUriString,
  surveyTargetID:
    'at://did:plc:abc/bio.cuanto.protocolTarget/3tgt' as l.AtUriString,
  taxonID: 'https://www.gbif.org/species/123' as l.UriString,
  organismQuantity: '5',
  organismQuantityType: 'individuals',
};

describe('insertOccurrence', () => {
  test('inserts when occurrence has eventID (no lat/lon)', async () => {
    await insertOccurrence(
      'did:plc:abc',
      '3occ',
      baseOccurrenceRecord,
      'at://did:plc:abc/bio.lexicons.temp.v0-1.occurrence/3occ',
    );
    // Two calls: NULL geom fragment + INSERT
    expect(mockSql).toHaveBeenCalledTimes(2);
  });

  test('calls sql with ST_MakePoint geom fragment when lat/lon are present', async () => {
    const record = {
      ...baseOccurrenceRecord,
      decimalLatitude: '34.05',
      decimalLongitude: '-118.24',
    };
    await insertOccurrence(
      'did:plc:abc',
      '3occ',
      record,
      'at://did:plc:abc/bio.lexicons.temp.v0-1.occurrence/3occ',
    );
    // sql called twice: once for the ST_MakePoint geom fragment, once for the INSERT
    expect(mockSql).toHaveBeenCalledTimes(2);
    // First call is the geom fragment — its template strings contain ST_MakePoint
    const [firstCallStrings] = mockSql.mock.calls[0] as [TemplateStringsArray];
    expect(firstCallStrings.join('')).toContain('ST_MakePoint');
  });

  test('calls sql once (no geom fragment) when lat/lon are absent', async () => {
    await insertOccurrence(
      'did:plc:abc',
      '3occ',
      baseOccurrenceRecord,
      'at://did:plc:abc/bio.lexicons.temp.v0-1.occurrence/3occ',
    );
    // sql called twice: once for NULL fragment, once for INSERT
    expect(mockSql).toHaveBeenCalledTimes(2);
  });

  test('calls sql with NULL geom when lat/lon are non-numeric', async () => {
    const record = {
      ...baseOccurrenceRecord,
      decimalLatitude: 'bad',
      decimalLongitude: 'bad',
    };
    await insertOccurrence(
      'did:plc:abc',
      '3occ',
      record,
      'at://did:plc:abc/bio.lexicons.temp.v0-1.occurrence/3occ',
    );
    // Still 2 calls: NULL fragment + INSERT
    expect(mockSql).toHaveBeenCalledTimes(2);
  });

  test('skips insert when eventID is absent', async () => {
    const record = { ...baseOccurrenceRecord, eventID: undefined };
    await insertOccurrence(
      'did:plc:abc',
      '3occ',
      record,
      'at://did:plc:abc/bio.lexicons.temp.v0-1.occurrence/3occ',
    );
    expect(mockSql).not.toHaveBeenCalled();
  });
});

// ── getLastSurveyByTargetUris ─────────────────────────────────────────────────

describe('getLastSurveyByTargetUris', () => {
  test('returns [] and makes no SQL call for an empty array', async () => {
    await expect(getLastSurveyByTargetUris([])).resolves.toEqual([]);
    expect(mockSql).not.toHaveBeenCalled();
  });

  test('calls sql once for a non-empty array', async () => {
    await getLastSurveyByTargetUris([
      'at://did:plc:abc/bio.cuanto.protocolTarget/3tgt',
    ]);
    expect(mockSql).toHaveBeenCalledOnce();
  });
});

// ── toLastSurveyMap ───────────────────────────────────────────────────────────

describe('toLastSurveyMap', () => {
  test('keys rows by target URI with an ISO date string', () => {
    const rows: LastSurveyRow[] = [
      {
        target_uri: 'at://did:plc:abc/bio.cuanto.protocolTarget/3tgt',
        survey_date: new Date('2026-04-13T10:00:00.000Z'),
        survey_handle: 'alice.test',
        survey_rkey: '3xyz',
      },
    ];
    expect(toLastSurveyMap(rows)).toEqual({
      'at://did:plc:abc/bio.cuanto.protocolTarget/3tgt': {
        date: '2026-04-13T10:00:00.000Z',
        handle: 'alice.test',
        rkey: '3xyz',
      },
    });
  });

  test('returns an empty object for no rows', () => {
    expect(toLastSurveyMap([])).toEqual({});
  });
});
