import { trackDistanceMeters } from './distance';
import { type GpsBbox, type GpsTrackPoint, trackToBbox } from './gpx';

const MINUTE_MS = 60_000;

// Epoch-millisecond bounds, inclusive at both ends.
export interface TimeRange {
  start: number;
  end: number;
}

// The span a track can be trimmed over, or null when it can't be trimmed by
// time at all: too few points, or points without timestamps (parseGpx records a
// missing <time> as 0).
export function trackTimeRange(points: GpsTrackPoint[]): TimeRange | null {
  if (points.length < 2) return null;
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (!p.timestamp) return null;
    if (p.timestamp < start) start = p.timestamp;
    if (p.timestamp > end) end = p.timestamp;
  }
  return end > start ? { start, end } : null;
}

export function trimTrack(
  points: GpsTrackPoint[],
  range: TimeRange,
): GpsTrackPoint[] {
  return points.filter(
    (p) => p.timestamp >= range.start && p.timestamp <= range.end,
  );
}

// Meters moved in each of `count` equal slices of `range`, for drawing a
// movement profile behind the trim slider. Each leg counts toward the slice its
// later point falls in. A slice with no points at all is null, so a gap in the
// recording reads differently from standing still.
export function movementBuckets(
  points: GpsTrackPoint[],
  range: TimeRange,
  count: number,
): (number | null)[] {
  const buckets: (number | null)[] = Array(count).fill(null);
  const span = range.end - range.start;
  if (span <= 0 || count < 1) return buckets;
  const bucketOf = (t: number) =>
    Math.min(
      count - 1,
      Math.max(0, Math.floor(((t - range.start) / span) * count)),
    );
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.timestamp < range.start || p.timestamp > range.end) continue;
    const b = bucketOf(p.timestamp);
    const leg = i > 0 ? trackDistanceMeters([points[i - 1], p]) : 0;
    buckets[b] = (buckets[b] ?? 0) + leg;
  }
  return buckets;
}

// Survey start and duration that cover a trimmed track. The form only holds
// minute precision, so start at the top of the first point's minute and round
// the duration up, leaving no kept point after the survey's end.
export function surveyTimingForRange(range: TimeRange): {
  start: number;
  durationMinutes: number;
} {
  const start = Math.floor(range.start / MINUTE_MS) * MINUTE_MS;
  const durationMinutes = Math.max(
    1,
    Math.ceil((range.end - start) / MINUTE_MS),
  );
  return { start, durationMinutes };
}

// The point and bbox a survey takes from its track: the track's bounds, and the
// center of those bounds, as surveyGeometry does for a new track survey.
export function surveyGeometryForTrack(points: GpsTrackPoint[]): {
  latitude: string | null;
  longitude: string | null;
  bbox: GpsBbox | null;
} {
  const bbox = trackToBbox(points);
  if (!bbox) return { latitude: null, longitude: null, bbox: null };
  return {
    latitude: String((parseFloat(bbox.north) + parseFloat(bbox.south)) / 2),
    longitude: String((parseFloat(bbox.east) + parseFloat(bbox.west)) / 2),
    bbox,
  };
}
