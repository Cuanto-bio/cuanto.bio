import { type GpsBbox, type GpsTrackPoint, trackToBbox } from '$lib/gpx';

export type GpsMode = 'none' | 'point' | 'bbox' | 'track';

export interface SurveyGeometryInput {
  /** "now" surveys record a live track; "past" surveys draw or upload geometry. */
  isLive: boolean;
  gpsMode: GpsMode;
  latitude: string | null;
  longitude: string | null;
  bbox: GpsBbox | null;
  /** Live recorder points when isLive, otherwise the drawn/uploaded track. */
  trackPoints: GpsTrackPoint[] | null;
}

export interface SurveyGeometry {
  latitude: string | null;
  longitude: string | null;
  bbox: GpsBbox | undefined;
  track: GpsTrackPoint[] | undefined;
}

/**
 * The geometry a survey will actually carry, given the form's location state.
 * Both the payload builder and the finish dialog's publish checkboxes derive
 * from this, so the user is never offered a toggle for geometry that isn't
 * there (or denied one for geometry that is).
 */
export function surveyGeometry(input: SurveyGeometryInput): SurveyGeometry {
  const { isLive, gpsMode, trackPoints } = input;
  let latitude: string | null;
  let longitude: string | null;
  let track: GpsTrackPoint[] | undefined;
  let bbox: GpsBbox | undefined;

  if (isLive) {
    // A live track is independent of gpsMode: protocols with predetermined
    // places show no mode selector, yet still let the surveyor record one.
    track = trackPoints?.length ? trackPoints : undefined;
    bbox = track ? (trackToBbox(track) ?? undefined) : undefined;
    latitude = input.latitude;
    longitude = input.longitude;
  } else {
    track =
      gpsMode === 'track' && trackPoints?.length ? trackPoints : undefined;
    bbox =
      gpsMode === 'bbox'
        ? (input.bbox ?? undefined)
        : track
          ? (trackToBbox(track) ?? undefined)
          : undefined;
    latitude = gpsMode === 'point' ? input.latitude : null;
    longitude = gpsMode === 'point' ? input.longitude : null;
  }

  // Freehand track surveys have no point of their own, so use the bbox centre.
  // Place-based surveys keep the place's coordinates.
  if (gpsMode === 'track' && bbox) {
    latitude = String((parseFloat(bbox.north) + parseFloat(bbox.south)) / 2);
    longitude = String((parseFloat(bbox.east) + parseFloat(bbox.west)) / 2);
  }

  return { latitude, longitude, bbox, track };
}

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
