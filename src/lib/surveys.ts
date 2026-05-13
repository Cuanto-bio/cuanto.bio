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
