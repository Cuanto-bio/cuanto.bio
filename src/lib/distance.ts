import type { GpsTrackPoint } from '$lib/gpx';

// Mean Earth radius (IUGG). A sphere is well within the noise of consumer GPS
// over the distances a survey track covers, so we skip the ellipsoidal models.
const EARTH_RADIUS_M = 6_371_008.8;

const METERS_PER_FOOT = 0.3048;
const METERS_PER_MILE = 1609.344;

export type DistanceUnit = 'm' | 'km' | 'ft' | 'mi';

export const DISTANCE_UNITS: ReadonlyArray<{
  value: DistanceUnit;
  label: string;
}> = [
  { value: 'm', label: 'meters' },
  { value: 'km', label: 'kilometers' },
  { value: 'ft', label: 'feet' },
  { value: 'mi', label: 'miles' },
];

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

// Haversine, which stays numerically stable for the short legs between
// consecutive fixes where the spherical law of cosines loses precision.
function haversineMeters(a: GpsTrackPoint, b: GpsTrackPoint): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = lat2 - lat1;
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Points may lack accuracy (e.g. resumed or parsed tracks). Treat a missing
// value as zero radius so we never filter out movement we can't vouch for.
function accuracyOf(p: GpsTrackPoint): number {
  return p.accuracy ?? 0;
}

// Straight-line distance between fixes, summed, with an accuracy-aware noise
// gate: consecutive fixes recorded while standing still still wander within
// their reported accuracy circle, and without this that wander gets counted
// as distance traveled. We keep an anchor point fixed until a fix falls
// outside the *combined* accuracy circle of the anchor and the candidate (the
// sum of their radii, below which the two fixes can't be distinguished from
// the same true location), then count the full jump from the anchor and move
// it there. Comparing against a persistent anchor, rather than only the
// immediately preceding point, means slow real drift still accumulates and
// eventually registers once it clears the anchor's noise circle, instead of
// being silently absorbed one sub-threshold hop at a time forever.
//
// Gaps (app backgrounded, signal lost) are bridged rather than skipped: the
// surveyor still walked that ground, even if we have no fixes along it.
export function trackDistanceMeters(points: GpsTrackPoint[]): number {
  if (points.length === 0) return 0;
  let anchor = points[0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const cand = points[i];
    const distance = haversineMeters(anchor, cand);
    const threshold = accuracyOf(anchor) + accuracyOf(cand);
    if (distance > threshold) {
      total += distance;
      anchor = cand;
    }
  }
  return total;
}

export function convertFromMeters(meters: number, unit: DistanceUnit): number {
  switch (unit) {
    case 'm':
      return meters;
    case 'km':
      return meters / 1000;
    case 'ft':
      return meters / METERS_PER_FOOT;
    case 'mi':
      return meters / METERS_PER_MILE;
  }
}

// Whole units for the small ones, two decimals for the large ones, so the
// readout keeps roughly the same significant figures whichever unit is picked.
const FRACTION_DIGITS: Record<DistanceUnit, number> = {
  m: 0,
  ft: 0,
  km: 2,
  mi: 2,
};

// The bare number, for callers that render the unit separately (a unit picker
// sitting next to the readout already names it).
export function formatDistanceValue(
  meters: number,
  unit: DistanceUnit,
): string {
  const digits = FRACTION_DIGITS[unit];
  return convertFromMeters(meters, unit).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatDistance(meters: number, unit: DistanceUnit): string {
  return `${formatDistanceValue(meters, unit)} ${unit}`;
}
