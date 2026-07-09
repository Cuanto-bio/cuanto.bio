export function validatePastTiming(
  pastDate: string,
  pastDurationMinutes: string,
): { dateError: string | null; durationError: string | null } {
  const dateError = pastDate ? null : 'Survey date is required';
  const dur = parseInt(pastDurationMinutes, 10);
  const durationError =
    !pastDurationMinutes || Number.isNaN(dur) || dur < 1
      ? 'Duration must be at least 1 minute'
      : null;
  return { dateError, durationError };
}

export function buildSurveyTiming(
  mode: 'now' | 'past',
  startedAt: number,
  elapsedSeconds: number,
  pastDate: string,
  pastDurationMinutes: string,
): { eventDate: string; eventDurationValue: number } {
  if (mode === 'past') {
    return {
      eventDate: new Date(pastDate).toISOString(),
      eventDurationValue: parseInt(pastDurationMinutes, 10),
    };
  }
  return {
    eventDate: new Date(startedAt).toISOString(),
    eventDurationValue: Math.max(1, Math.round(elapsedSeconds / 60)),
  };
}

export function calcElapsed(startedAt: number): number {
  return Math.floor((Date.now() - startedAt) / 1000);
}

export function formatElapsed(s: number): string {
  const m = Math.floor(s / 60)
    .toString()
    .padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

/** The resolved taxon data sent to the server for each incidental occurrence. */
export interface IncidentalInput {
  taxonID: string;
  scientificName: string;
  taxonRank: string;
  vernacularName?: string;
  kingdom?: string;
  organismQuantity?: string;
}

/**
 * Local (IDB) representation of an incidental occurrence. All taxon fields are
 * optional so unresolved (offline placeholder) incidentals can be stored.
 * Partial<IncidentalInput> ensures any field added to the server type is
 * automatically available (optional) here, preventing the two from drifting.
 */
export type IncidentalOccurrence = Partial<IncidentalInput> & {
  localId: string;
  placeholder?: string;
};

export function validateSurveyorCount(
  requiredFields: string[] | undefined,
  surveyorCountStr: string,
): string | null {
  if (surveyorCountStr) {
    const n = Number(surveyorCountStr);
    if (!Number.isInteger(n) || n < 1) {
      return 'Number of surveyors must be a positive integer';
    }
  }
  if (requiredFields?.includes('surveyorCount') && !surveyorCountStr) {
    return 'Number of surveyors is required';
  }
  return null;
}

export function hasUnresolvedIncidentals(
  incidentals: IncidentalOccurrence[],
): boolean {
  return incidentals.some((i) => !i.taxonID);
}

/**
 * Whether resuming a saved draft should pick live GPS track recording back up.
 * Only a survey still in progress that was actively recording when it was saved
 * resumes; a track the user stopped, and a finished (complete) survey being
 * edited before upload, both stay stopped.
 *
 * Takes a structural type rather than PendingSurvey so this module stays free of
 * an import cycle with offline/db, which imports IncidentalOccurrence from here.
 */
export function shouldResumeTrackRecording(
  resumeState: { trackRecording?: boolean; complete?: boolean } | undefined,
): boolean {
  if (!resumeState || resumeState.complete) return false;
  return resumeState.trackRecording === true;
}

export interface SurveyParams {
  protocolUris?: string[];
  startDate?: string;
  stopDate?: string;
  bbox?: {
    north: string | null;
    west: string | null;
    east: string | null;
    south: string | null;
  };
  taxonID?: string | null;
}

export function urlToSurveyParams(url: URL): SurveyParams {
  const protocolsParam = url.searchParams.get('protocols');
  const protocolUris = protocolsParam
    ? protocolsParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const north = url.searchParams.get('bboxNorth');
  const south = url.searchParams.get('bboxSouth');
  const east = url.searchParams.get('bboxEast');
  const west = url.searchParams.get('bboxWest');

  return {
    protocolUris,
    startDate: url.searchParams.get('start') ?? '',
    stopDate: url.searchParams.get('stop') ?? '',
    bbox: { north, south, east, west },
    taxonID: url.searchParams.get('taxonID'),
  };
}
