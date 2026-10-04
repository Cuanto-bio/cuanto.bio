import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/db/surveys', () => ({
  getSurveysByDid: vi.fn(),
  getOccurrencesForSurveys: vi.fn(),
  groupOccurrencesBySurvey: vi.fn(),
  toSurveyResponse: vi.fn(),
  attachRemarks: vi.fn(),
}));

vi.mock('$lib/server/db/identifications', () => ({
  getIdentificationsForOccurrences: vi.fn(),
}));

vi.mock('$lib/server/db/survey-protocols', () => ({
  getFollowedProtocolsByDid: vi.fn(),
}));

import { getIdentificationsForOccurrences } from '$lib/server/db/identifications';
import { getFollowedProtocolsByDid } from '$lib/server/db/survey-protocols';
import {
  attachRemarks,
  getOccurrencesForSurveys,
  getSurveysByDid,
  groupOccurrencesBySurvey,
  toSurveyResponse,
} from '$lib/server/db/surveys';
import { GET } from './+server';

const DID = 'did:test:sync-spec';
const SURVEY_URI = `at://${DID}/bio.cuanto.survey/s1`;
const TARGET_URI = `at://${DID}/bio.cuanto.protocolTarget/t1`;
const INCIDENTAL_URI = `at://${DID}/bio.lexicons.temp.v0-1.occurrence/occ-incidental`;
const TARGETED_URI = `at://${DID}/bio.lexicons.temp.v0-1.occurrence/occ-targeted`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getFollowedProtocolsByDid).mockResolvedValue([]);
  vi.mocked(getSurveysByDid).mockResolvedValue([]);
  vi.mocked(getOccurrencesForSurveys).mockResolvedValue([
    {
      at_uri: INCIDENTAL_URI,
      survey_uri: SURVEY_URI,
      // no surveyTargetID → incidental
      record: {
        $type: 'bio.lexicons.temp.v0-1.occurrence',
        eventID: SURVEY_URI,
      } as unknown as Parameters<
        typeof groupOccurrencesBySurvey
      >[0][0]['record'],
    },
    {
      at_uri: TARGETED_URI,
      survey_uri: SURVEY_URI,
      // has surveyTargetID → not an incidental
      record: {
        $type: 'bio.lexicons.temp.v0-1.occurrence',
        eventID: SURVEY_URI,
        surveyTargetID: TARGET_URI,
      } as unknown as Parameters<
        typeof groupOccurrencesBySurvey
      >[0][0]['record'],
    },
  ]);
  vi.mocked(getIdentificationsForOccurrences).mockResolvedValue(
    new Map([
      [
        INCIDENTAL_URI,
        {
          scientificName: 'Lupinus chamissonis',
          vernacularName: 'Silver bush lupine',
        },
      ],
    ]),
  );
  vi.mocked(groupOccurrencesBySurvey).mockReturnValue(new Map());
  vi.mocked(toSurveyResponse).mockReturnValue([]);
});

describe('GET /api/sync', () => {
  test('fetches identifications only for incidental occurrences', async () => {
    const resp = await GET({
      locals: { did: DID },
    } as unknown as Parameters<typeof GET>[0]);
    expect(resp.status).toBe(200);
    expect(vi.mocked(getIdentificationsForOccurrences)).toHaveBeenCalledWith([
      INCIDENTAL_URI,
    ]);
    expect(
      vi.mocked(getIdentificationsForOccurrences),
    ).not.toHaveBeenCalledWith(expect.arrayContaining([TARGETED_URI]));
  });

  test('passes identification data to groupOccurrencesBySurvey', async () => {
    await GET({
      locals: { did: DID },
    } as unknown as Parameters<typeof GET>[0]);
    expect(vi.mocked(groupOccurrencesBySurvey)).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          at_uri: INCIDENTAL_URI,
          identification: {
            scientificName: 'Lupinus chamissonis',
            vernacularName: 'Silver bush lupine',
          },
        }),
      ]),
    );
  });
});

describe('GET /api/sync — event remarks', () => {
  test('hydrates remarks onto the surveys it hands the offline cache', async () => {
    // syncOfflineData runs on every /app navigation and cacheSurvey overwrites
    // the whole IndexedDB entry, so a sync payload missing the remark would strip
    // it from a copy the detail page had already cached in full.
    const withRemark = [
      {
        atUri: SURVEY_URI,
        record: {
          eventRemarksID: `at://${DID}/bio.lexicons.temp.v0-1.remark/s1`,
        },
        eventRemark: {
          atUri: `at://${DID}/bio.lexicons.temp.v0-1.remark/s1`,
          body: 'Foggy.',
        },
      },
    ];
    vi.mocked(toSurveyResponse).mockReturnValue(
      [] as unknown as ReturnType<typeof toSurveyResponse>,
    );
    vi.mocked(attachRemarks).mockResolvedValue(
      withRemark as unknown as Awaited<ReturnType<typeof attachRemarks>>,
    );

    const resp = await GET({ locals: { did: DID } } as unknown as Parameters<
      typeof GET
    >[0]);

    expect(attachRemarks).toHaveBeenCalled();
    const body = (await resp.json()) as {
      surveys: { eventRemark?: { body: string } }[];
    };
    expect(body.surveys[0].eventRemark?.body).toBe('Foggy.');
  });
});
