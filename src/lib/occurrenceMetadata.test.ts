import { describe, expect, test } from 'vitest';
import {
  mergeOccurrenceMetadata,
  occurrenceMetadataFromSurveyInput,
  surveyEventDateToOccurrenceDate,
} from './occurrenceMetadata';

describe('surveyEventDateToOccurrenceDate', () => {
  test('strips the time component from a full timestamp', () => {
    expect(surveyEventDateToOccurrenceDate('2026-02-03T10:30:00.000Z')).toBe(
      '2026-02-03',
    );
  });

  test('leaves a date-only value unchanged', () => {
    expect(surveyEventDateToOccurrenceDate('2026-02-03')).toBe('2026-02-03');
  });

  test('leaves a year-month value unchanged', () => {
    expect(surveyEventDateToOccurrenceDate('2026-02')).toBe('2026-02');
  });

  test('leaves a year-only value unchanged', () => {
    expect(surveyEventDateToOccurrenceDate('2026')).toBe('2026');
  });

  test('does not append a synthetic time or timezone', () => {
    const out = surveyEventDateToOccurrenceDate('1963-03-08T14:07:00-06:00');
    expect(out).toBe('1963-03-08');
    expect(out).not.toContain('T');
  });
});

describe('occurrenceMetadataFromSurveyInput', () => {
  test('point only: passes coords through, no uncertainty', () => {
    const meta = occurrenceMetadataFromSurveyInput({
      eventDate: '2026-02-03T10:30:00.000Z',
      latitude: '37.1234567',
      longitude: '-122.7654321',
    });
    expect(meta).toEqual({
      eventDate: '2026-02-03',
      decimalLatitude: '37.1234567',
      decimalLongitude: '-122.7654321',
    });
    expect(meta.coordinateUncertaintyInMeters).toBeUndefined();
  });

  test('bbox present: centroid to 7 decimals + integer uncertainty', () => {
    const meta = occurrenceMetadataFromSurveyInput({
      eventDate: '2026-02-03',
      latitude: null,
      longitude: null,
      gpsBbox: { north: '38', south: '36', east: '-122', west: '-124' },
    });
    expect(meta.decimalLatitude).toBe('37.0000000');
    expect(meta.decimalLongitude).toBe('-123.0000000');
    expect(Number.isInteger(meta.coordinateUncertaintyInMeters)).toBe(true);
  });

  test('bbox present: ~1km box yields a roughly 700m uncertainty', () => {
    const meta = occurrenceMetadataFromSurveyInput({
      eventDate: '2026-02-03',
      latitude: null,
      longitude: null,
      gpsBbox: {
        north: '0.0045',
        south: '-0.0045',
        east: '0.0045',
        west: '-0.0045',
      },
    });
    expect(meta.decimalLatitude).toBe('0.0000000');
    expect(meta.decimalLongitude).toBe('0.0000000');
    expect(meta.coordinateUncertaintyInMeters).toBeGreaterThan(690);
    expect(meta.coordinateUncertaintyInMeters).toBeLessThan(725);
  });

  test('point + bbox: bbox wins', () => {
    const meta = occurrenceMetadataFromSurveyInput({
      eventDate: '2026-02-03',
      latitude: '10',
      longitude: '20',
      gpsBbox: { north: '38', south: '36', east: '-122', west: '-124' },
    });
    expect(meta.decimalLatitude).toBe('37.0000000');
    expect(meta.decimalLongitude).toBe('-123.0000000');
    expect(meta.coordinateUncertaintyInMeters).toBeDefined();
  });

  test('neither point nor bbox: just eventDate', () => {
    const meta = occurrenceMetadataFromSurveyInput({
      eventDate: '2026-02-03T10:30:00.000Z',
      latitude: null,
      longitude: null,
    });
    expect(meta).toEqual({ eventDate: '2026-02-03' });
  });
});

describe('mergeOccurrenceMetadata', () => {
  const meta = {
    eventDate: '2026-02-03',
    decimalLatitude: '37.0000000',
    decimalLongitude: '-123.0000000',
    coordinateUncertaintyInMeters: 708,
  };

  test('returns meta unchanged when there is no existing record', () => {
    expect(mergeOccurrenceMetadata(undefined, meta)).toEqual(meta);
  });

  test('keeps existing eventDate but fills blank coords from meta', () => {
    const out = mergeOccurrenceMetadata({ eventDate: '1999-01-01' }, meta);
    expect(out.eventDate).toBe('1999-01-01');
    expect(out.decimalLatitude).toBe('37.0000000');
    expect(out.decimalLongitude).toBe('-123.0000000');
    expect(out.coordinateUncertaintyInMeters).toBe(708);
  });

  test('keeps existing coords and existing uncertainty, ignoring meta', () => {
    const out = mergeOccurrenceMetadata(
      {
        eventDate: '1999-01-01',
        decimalLatitude: '1.1111111',
        decimalLongitude: '2.2222222',
      },
      meta,
    );
    expect(out.decimalLatitude).toBe('1.1111111');
    expect(out.decimalLongitude).toBe('2.2222222');
    // existing had no uncertainty → stays absent, not pulled from meta
    expect(out.coordinateUncertaintyInMeters).toBeUndefined();
  });

  test('fills eventDate from meta when existing eventDate is blank', () => {
    const out = mergeOccurrenceMetadata({ eventDate: '' }, meta);
    expect(out.eventDate).toBe('2026-02-03');
  });
});
