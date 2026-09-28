import { describe, expect, test } from 'vitest';
import type { GpsTrackPoint } from './gpx';
import {
  movementBuckets,
  surveyGeometryForTrack,
  surveyTimingForRange,
  trackTimeRange,
  trimTrack,
} from './trackTrim';

const t0 = new Date('2026-05-27T10:00:00.000Z').getTime();
const MIN = 60_000;

function pt(offsetMs: number, lat = 37.7749, lng = -122.4194): GpsTrackPoint {
  return { lat, lng, timestamp: t0 + offsetMs };
}

// Latitude reached by moving `meters` due north of `lat`.
function northOf(lat: number, meters: number): number {
  return lat + (meters / 6_371_008.8) * (180 / Math.PI);
}

describe('trackTimeRange', () => {
  test('spans the first to last timestamp', () => {
    expect(trackTimeRange([pt(0), pt(MIN), pt(5 * MIN)])).toEqual({
      start: t0,
      end: t0 + 5 * MIN,
    });
  });

  test('is null for fewer than two points', () => {
    expect(trackTimeRange([])).toBeNull();
    expect(trackTimeRange([pt(0)])).toBeNull();
  });

  test('is null when any point lacks a timestamp', () => {
    // parseGpx records a missing <time> as 0
    expect(
      trackTimeRange([pt(0), { lat: 1, lng: 1, timestamp: 0 }, pt(MIN)]),
    ).toBeNull();
  });

  test('is null when all points share one timestamp', () => {
    expect(trackTimeRange([pt(0), pt(0)])).toBeNull();
  });

  test('uses the earliest and latest timestamps even if out of order', () => {
    expect(trackTimeRange([pt(MIN), pt(0), pt(3 * MIN)])).toEqual({
      start: t0,
      end: t0 + 3 * MIN,
    });
  });
});

describe('trimTrack', () => {
  const points = [pt(0), pt(MIN), pt(2 * MIN), pt(3 * MIN), pt(4 * MIN)];

  test('keeps points within the range, inclusive of both ends', () => {
    const kept = trimTrack(points, { start: t0 + MIN, end: t0 + 3 * MIN });
    expect(kept.map((p) => p.timestamp)).toEqual([
      t0 + MIN,
      t0 + 2 * MIN,
      t0 + 3 * MIN,
    ]);
  });

  test('drops points collected after the end', () => {
    const kept = trimTrack(points, { start: t0, end: t0 + 90_000 });
    expect(kept.map((p) => p.timestamp)).toEqual([t0, t0 + MIN]);
  });

  test('keeps everything when the range covers the track', () => {
    expect(trimTrack(points, { start: t0, end: t0 + 4 * MIN })).toEqual(points);
  });
});

describe('movementBuckets', () => {
  test('attributes each leg to the bucket of its later point', () => {
    const lat = 37.7749;
    const points = [
      pt(0, lat),
      pt(MIN, northOf(lat, 100)),
      // stationary for the second half
      pt(3 * MIN, northOf(lat, 100)),
      pt(4 * MIN, northOf(lat, 100)),
    ];
    const buckets = movementBuckets(
      points,
      { start: t0, end: t0 + 4 * MIN },
      2,
    );
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toBeCloseTo(100, 0);
    expect(buckets[1]).toBe(0);
  });

  test('marks buckets with no points as null', () => {
    // A gap between 1 and 5 minutes, e.g. GPS lost signal
    const points = [pt(0), pt(MIN), pt(5 * MIN), pt(6 * MIN)];
    const buckets = movementBuckets(
      points,
      { start: t0, end: t0 + 6 * MIN },
      6,
    );
    expect(buckets[2]).toBeNull();
    expect(buckets[3]).toBeNull();
    expect(buckets[0]).not.toBeNull();
  });

  test('puts the final point in the last bucket', () => {
    const lat = 37.7749;
    const points = [pt(0, lat), pt(2 * MIN, northOf(lat, 50))];
    const buckets = movementBuckets(
      points,
      { start: t0, end: t0 + 2 * MIN },
      2,
    );
    expect(buckets[1]).toBeCloseTo(50, 0);
  });
});

describe('surveyTimingForRange', () => {
  test('starts at the minute of the first kept point', () => {
    const timing = surveyTimingForRange({
      start: t0 + 30_000,
      end: t0 + 10 * MIN,
    });
    expect(timing.start).toBe(t0);
  });

  test('rounds the duration up so the survey covers the whole track', () => {
    const timing = surveyTimingForRange({
      start: t0 + 30_000,
      end: t0 + 10 * MIN + 5_000,
    });
    expect(timing.durationMinutes).toBe(11);
  });

  test('never reports a duration under one minute', () => {
    const timing = surveyTimingForRange({ start: t0, end: t0 });
    expect(timing.durationMinutes).toBe(1);
  });
});

describe('surveyGeometryForTrack', () => {
  test('bounds the track and puts the point at the center of the bounds', () => {
    const geometry = surveyGeometryForTrack([
      pt(0, 37, -122),
      pt(MIN, 38, -121),
      pt(2 * MIN, 37.5, -123),
    ]);
    expect(geometry.bbox).toEqual({
      north: '38',
      south: '37',
      east: '-121',
      west: '-123',
    });
    expect(geometry.latitude).toBe('37.5');
    expect(geometry.longitude).toBe('-122');
  });

  test('is empty for an empty track', () => {
    expect(surveyGeometryForTrack([])).toEqual({
      latitude: null,
      longitude: null,
      bbox: null,
    });
  });
});
