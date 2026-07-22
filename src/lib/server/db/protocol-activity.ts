import type { Survey } from '$lib/offline/db';
import { getProtocolStats, type WeeklyPoint } from './stats.js';
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
  // Keyed by protocolTarget URI. Unlike targetStats this includes targets that
  // were sought but never counted, so a missing entry here means the target was
  // never in scope for any recent survey.
  //
  // Grows as targets x SPARKBAR_WEEKS, and the Targets tab draws a sparkbar for
  // every target, so this is proportional to what that tab renders rather than
  // fetched and discarded. It does ride along on the initial load even though
  // Surveys is the default tab; that is deliberate, since splitting it out
  // would trade payload size for a second round-trip on tab switch. Worth
  // revisiting only if a protocol accumulates targets faster than the tab can
  // usefully list them, at which point the table needs paging anyway.
  targetWeekly: Record<string, WeeklyPoint[]>;
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
    targetWeekly: stats.targetWeekly,
    lastSurveyByTargetUri: toLastSurveyMap(lastSurveyRows),
  };
}
