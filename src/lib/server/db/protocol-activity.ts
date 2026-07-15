import type { Survey } from '$lib/offline/db';
import { getProtocolStats } from './stats.js';
import {
  getLastSurveyByTargetUris,
  getSurveysPage,
  type LastSurveyByTargetUri,
  toLastSurveyMap,
} from './surveys.js';

export const RECENT_SURVEY_LIMIT = 10;

export type TargetActivity = {
  surveyCount: number;
  totalCount: number;
};

export type ProtocolActivity = {
  surveyCount: number;
  recentSurveys: Survey[];
  // Keyed by protocolTarget URI. Targets nobody has counted are absent, so
  // consumers must treat a missing entry as zero rather than "unknown".
  targetStats: Record<string, TargetActivity>;
  lastSurveyByTargetUri: LastSurveyByTargetUri;
};

// Everything the protocol detail page shows that isn't part of the protocol
// record itself: how much surveying has happened under it, and by whom.
export async function getProtocolActivity(
  protocolUri: string,
  targetUris: string[],
): Promise<ProtocolActivity> {
  const [stats, recentSurveys, lastSurveyRows] = await Promise.all([
    getProtocolStats({ protocolUris: [protocolUri] }),
    getSurveysPage(RECENT_SURVEY_LIMIT, 0, { protocolUris: [protocolUri] }),
    getLastSurveyByTargetUris(targetUris),
  ]);

  const targetStats: Record<string, TargetActivity> = {};
  for (const target of stats.targets) {
    targetStats[target.protocolTargetUri] = {
      surveyCount: target.surveyCount,
      totalCount: target.totalCount,
    };
  }

  return {
    surveyCount: stats.surveyCount,
    recentSurveys,
    targetStats,
    lastSurveyByTargetUri: toLastSurveyMap(lastSurveyRows),
  };
}
