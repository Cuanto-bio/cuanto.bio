import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { IncidentalOccurrence } from './surveys';
import {
  buildSurveyTiming,
  calcElapsed,
  formatElapsed,
  hasUnresolvedIncidentals,
  shouldResumeTrackRecording,
  surveyGeometry,
  validatePastTiming,
  validateSurveyorCount,
} from './surveys';

describe('calcElapsed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('returns 0 when no time has elapsed', () => {
    const start = Date.now();
    expect(calcElapsed(start)).toBe(0);
  });

  test('returns correct seconds after time passes without any interval ticks', () => {
    const start = Date.now();
    vi.advanceTimersByTime(3600_000); // advance 1 hour without any ticks
    expect(calcElapsed(start)).toBe(3600);
  });

  test('returns correct seconds for a partial minute', () => {
    const start = Date.now();
    vi.advanceTimersByTime(90_000);
    expect(calcElapsed(start)).toBe(90);
  });
});

describe('formatElapsed', () => {
  test('formats zero as 00:00', () => {
    expect(formatElapsed(0)).toBe('00:00');
  });

  test('formats 90 seconds as 01:30', () => {
    expect(formatElapsed(90)).toBe('01:30');
  });

  test('formats 3600 seconds as 60:00', () => {
    expect(formatElapsed(3600)).toBe('60:00');
  });
});

describe('validatePastTiming', () => {
  test('returns no errors when date and duration are valid', () => {
    expect(validatePastTiming('2025-10-12T14:30', '45')).toEqual({
      dateError: null,
      durationError: null,
    });
  });

  test('returns dateError when pastDate is empty', () => {
    const { dateError } = validatePastTiming('', '45');
    expect(dateError).not.toBeNull();
  });

  test('returns durationError when pastDurationMinutes is empty', () => {
    const { durationError } = validatePastTiming('2025-10-12T14:30', '');
    expect(durationError).not.toBeNull();
  });

  test('returns durationError when duration is zero', () => {
    const { durationError } = validatePastTiming('2025-10-12T14:30', '0');
    expect(durationError).not.toBeNull();
  });

  test('returns durationError when duration is not a number', () => {
    const { durationError } = validatePastTiming('2025-10-12T14:30', 'abc');
    expect(durationError).not.toBeNull();
  });
});

describe('buildSurveyTiming', () => {
  const startedAt = new Date('2025-10-12T10:00:00Z').getTime();

  test('now mode uses startedAt for eventDate', () => {
    const { eventDate } = buildSurveyTiming('now', startedAt, 300, '', '');
    expect(eventDate).toBe(new Date(startedAt).toISOString());
  });

  test('now mode rounds elapsedSeconds to minutes, minimum 1', () => {
    expect(
      buildSurveyTiming('now', startedAt, 0, '', '').eventDurationValue,
    ).toBe(1);
    expect(
      buildSurveyTiming('now', startedAt, 90, '', '').eventDurationValue,
    ).toBe(2);
    expect(
      buildSurveyTiming('now', startedAt, 300, '', '').eventDurationValue,
    ).toBe(5);
  });

  test('past mode uses pastDate for eventDate', () => {
    const { eventDate } = buildSurveyTiming(
      'past',
      startedAt,
      0,
      '2025-08-01T09:00',
      '',
    );
    expect(eventDate).toBe(new Date('2025-08-01T09:00').toISOString());
  });

  test('past mode uses pastDurationMinutes for eventDurationValue', () => {
    const { eventDurationValue } = buildSurveyTiming(
      'past',
      startedAt,
      0,
      '2025-08-01T09:00',
      '45',
    );
    expect(eventDurationValue).toBe(45);
  });
});

describe('validateSurveyorCount', () => {
  test('returns null when empty and not required', () => {
    expect(validateSurveyorCount([], '')).toBeNull();
    expect(validateSurveyorCount(undefined, '')).toBeNull();
  });

  test('returns required error when empty and field is required', () => {
    expect(validateSurveyorCount(['surveyorCount'], '')).toBe(
      'Number of surveyors is required',
    );
  });

  test('returns null for valid positive integers', () => {
    expect(validateSurveyorCount([], '1')).toBeNull();
    expect(validateSurveyorCount([], '5')).toBeNull();
    expect(validateSurveyorCount(['surveyorCount'], '3')).toBeNull();
  });

  test('returns error for zero', () => {
    expect(validateSurveyorCount([], '0')).toBe(
      'Number of surveyors must be a positive integer',
    );
  });

  test('returns error for negative values', () => {
    expect(validateSurveyorCount([], '-1')).toBe(
      'Number of surveyors must be a positive integer',
    );
  });

  test('returns error for decimals', () => {
    expect(validateSurveyorCount([], '1.5')).toBe(
      'Number of surveyors must be a positive integer',
    );
  });

  test('returns error for non-numeric text', () => {
    expect(validateSurveyorCount([], 'fdhfdh')).toBe(
      'Number of surveyors must be a positive integer',
    );
  });
});

describe('hasUnresolvedIncidentals', () => {
  test('returns false for an empty array', () => {
    expect(hasUnresolvedIncidentals([])).toBe(false);
  });

  test('returns false when all incidentals have taxonID', () => {
    const incidentals: IncidentalOccurrence[] = [
      {
        localId: '1',
        taxonID: 'https://www.inaturalist.org/taxa/12345',
        scientificName: 'Quercus agrifolia',
        taxonRank: 'species',
      },
    ];
    expect(hasUnresolvedIncidentals(incidentals)).toBe(false);
  });

  test('returns true when an incidental lacks taxonID', () => {
    const incidentals: IncidentalOccurrence[] = [
      { localId: '1', placeholder: 'small brown bird' },
    ];
    expect(hasUnresolvedIncidentals(incidentals)).toBe(true);
  });

  test('returns true when some are resolved and some are not', () => {
    const incidentals: IncidentalOccurrence[] = [
      {
        localId: '1',
        taxonID: 'https://www.inaturalist.org/taxa/12345',
        scientificName: 'Quercus agrifolia',
        taxonRank: 'species',
      },
      { localId: '2', placeholder: 'mystery fern' },
    ];
    expect(hasUnresolvedIncidentals(incidentals)).toBe(true);
  });
});

describe('shouldResumeTrackRecording', () => {
  test('returns true for an in-progress draft that was recording', () => {
    expect(
      shouldResumeTrackRecording({ trackRecording: true, complete: false }),
    ).toBe(true);
  });

  test('returns false when the draft was not recording', () => {
    expect(
      shouldResumeTrackRecording({ trackRecording: false, complete: false }),
    ).toBe(false);
  });

  test('returns false for a draft saved before trackRecording existed', () => {
    expect(shouldResumeTrackRecording({ complete: false })).toBe(false);
  });

  test('returns false when editing an un-uploaded (complete) survey', () => {
    expect(
      shouldResumeTrackRecording({ trackRecording: true, complete: true }),
    ).toBe(false);
  });

  test('returns false with no resume state', () => {
    expect(shouldResumeTrackRecording(undefined)).toBe(false);
  });
});

describe('surveyGeometry', () => {
  const trackPoints = [
    { lat: 37.0, lng: -122.0, timestamp: 1 },
    { lat: 37.2, lng: -122.4, timestamp: 2 },
  ];

  test('live survey keeps the place coordinates alongside a recorded track', () => {
    const geom = surveyGeometry({
      isLive: true,
      // Protocols with predetermined places pin gpsMode to 'point'.
      gpsMode: 'point',
      latitude: '38.004',
      longitude: '-122.4978',
      bbox: null,
      trackPoints,
    });
    expect(geom.latitude).toBe('38.004');
    expect(geom.longitude).toBe('-122.4978');
    expect(geom.track).toEqual(trackPoints);
    expect(geom.bbox).toEqual({
      north: '37.2',
      south: '37',
      east: '-122',
      west: '-122.4',
    });
  });

  test('live survey for a name-only place offers the track but no point', () => {
    // A name-only predetermined place has no coordinates, so selectLocation
    // leaves gpsMode 'none' and latitude/longitude null. A recorded track still
    // yields a bbox and track, but there is no point to publish.
    const geom = surveyGeometry({
      isLive: true,
      gpsMode: 'none',
      latitude: null,
      longitude: null,
      bbox: null,
      trackPoints,
    });
    expect(geom.latitude).toBeNull();
    expect(geom.longitude).toBeNull();
    expect(geom.track).toEqual(trackPoints);
    expect(geom.bbox).toEqual({
      north: '37.2',
      south: '37',
      east: '-122',
      west: '-122.4',
    });
  });

  test('live survey with no track and no point has no geometry', () => {
    const geom = surveyGeometry({
      isLive: true,
      gpsMode: 'none',
      latitude: null,
      longitude: null,
      bbox: null,
      trackPoints: [],
    });
    expect(geom).toEqual({
      latitude: null,
      longitude: null,
      bbox: undefined,
      track: undefined,
    });
  });

  test('track mode derives the point from the bbox centre', () => {
    const geom = surveyGeometry({
      isLive: false,
      gpsMode: 'track',
      latitude: null,
      longitude: null,
      bbox: null,
      trackPoints,
    });
    expect(geom.latitude).toBe('37.1');
    expect(geom.longitude).toBe('-122.2');
    expect(geom.track).toEqual(trackPoints);
  });

  test('bbox mode keeps the drawn bbox and drops point and track', () => {
    const bbox = { north: '38', south: '37', east: '-122', west: '-123' };
    const geom = surveyGeometry({
      isLive: false,
      gpsMode: 'bbox',
      latitude: '37.5',
      longitude: '-122.5',
      bbox,
      trackPoints,
    });
    expect(geom.bbox).toBe(bbox);
    expect(geom.latitude).toBeNull();
    expect(geom.longitude).toBeNull();
    expect(geom.track).toBeUndefined();
  });

  test('point mode drops a stale drawn bbox and track', () => {
    const geom = surveyGeometry({
      isLive: false,
      gpsMode: 'point',
      latitude: '37.5',
      longitude: '-122.5',
      bbox: { north: '38', south: '37', east: '-122', west: '-123' },
      trackPoints,
    });
    expect(geom.latitude).toBe('37.5');
    expect(geom.bbox).toBeUndefined();
    expect(geom.track).toBeUndefined();
  });
});
