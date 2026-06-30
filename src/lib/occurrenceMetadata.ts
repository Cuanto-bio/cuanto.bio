// Derives the Darwin Core spatial/temporal metadata an Occurrence inherits from
// its parent Survey. We model one Occurrence per survey target as an aggregate
// count across the whole survey, so the metadata is deliberately coarse: a
// date (not the survey's start datetime) and the survey's point, or the centroid
// of its bounding box. Populating these record fields also lights up the
// `occurrences.geom` column, which `insertOccurrence` derives from
// `decimalLatitude`/`decimalLongitude`.

export type GpsBbox = {
  north: string;
  south: string;
  east: string;
  west: string;
};

export type OccurrenceMetadata = {
  eventDate: string;
  decimalLatitude?: string;
  decimalLongitude?: string;
  coordinateUncertaintyInMeters?: number;
};

// Coordinate precision (~1cm) matching `COORD_PRECISION` in
// src/lib/map/locationGeometry.ts.
const COORD_PRECISION = 7;
const fmt = (n: number) => n.toFixed(COORD_PRECISION);

// Metres per degree of latitude (and of longitude at the equator).
const METERS_PER_DEGREE = 111320;

// The survey's eventDate is the datetime the survey began, but an Occurrence is
// the aggregate of every individual seen across the survey and has no single
// meaningful time. So the Occurrence's eventDate is the date portion only. This
// leaves already date-granularity values (`2026`, `2026-02`) untouched and never
// synthesizes a time or timezone.
export function surveyEventDateToOccurrenceDate(eventDate: string): string {
  return eventDate.trim().split('T')[0];
}

function blank(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function bboxMetadata(bbox: GpsBbox): {
  decimalLatitude: string;
  decimalLongitude: string;
  coordinateUncertaintyInMeters: number;
} {
  const north = parseFloat(bbox.north);
  const south = parseFloat(bbox.south);
  const east = parseFloat(bbox.east);
  const west = parseFloat(bbox.west);

  const midLat = (north + south) / 2;
  const midLng = (east + west) / 2;

  // Centre-to-corner distance (half the diagonal) via an equirectangular
  // approximation. Like the existing inline centroid code this does not
  // special-case antimeridian-crossing boxes; Math.abs keeps the value
  // non-negative.
  const dLatM = Math.abs(north - south) * METERS_PER_DEGREE;
  const dLngM =
    Math.abs(east - west) *
    METERS_PER_DEGREE *
    Math.cos((midLat * Math.PI) / 180);
  const coordinateUncertaintyInMeters = Math.round(
    Math.hypot(dLatM, dLngM) / 2,
  );

  return {
    decimalLatitude: fmt(midLat),
    decimalLongitude: fmt(midLng),
    coordinateUncertaintyInMeters,
  };
}

// Maps a survey's raw inputs to the metadata each of its occurrences should
// carry. A bounding box (an area) takes precedence over a single point.
export function occurrenceMetadataFromSurveyInput(input: {
  eventDate: string;
  latitude: string | null;
  longitude: string | null;
  gpsBbox?: GpsBbox | null;
}): OccurrenceMetadata {
  const eventDate = surveyEventDateToOccurrenceDate(input.eventDate);

  if (input.gpsBbox) {
    return { eventDate, ...bboxMetadata(input.gpsBbox) };
  }
  if (input.latitude && input.longitude) {
    return {
      eventDate,
      decimalLatitude: input.latitude,
      decimalLongitude: input.longitude,
    };
  }
  return { eventDate };
}

type ExistingOccMetaFields = {
  eventDate?: string;
  decimalLatitude?: string;
  decimalLongitude?: string;
  coordinateUncertaintyInMeters?: number;
};

// Resolves the effective metadata for one occurrence on a re-save. The PUT
// handler rebuilds every occurrence record from scratch, so we fill only the
// gaps and never clobber values already on the record: an existing eventDate or
// an existing coordinate pair is carried forward verbatim. Passing
// `existing = undefined` (the create path and new-occurrence edit path) returns
// `meta` wholesale.
export function mergeOccurrenceMetadata(
  existing: ExistingOccMetaFields | undefined,
  meta: OccurrenceMetadata,
): OccurrenceMetadata {
  if (!existing) return meta;

  const eventDate = blank(existing.eventDate)
    ? meta.eventDate
    : (existing.eventDate as string);

  // Coordinates are treated as one unit keyed on both coords being present, so
  // we never mix an existing lat with a derived lng. When the existing pair is
  // present we carry forward its uncertainty too, even when blank.
  if (!blank(existing.decimalLatitude) && !blank(existing.decimalLongitude)) {
    return {
      eventDate,
      decimalLatitude: existing.decimalLatitude,
      decimalLongitude: existing.decimalLongitude,
      ...(existing.coordinateUncertaintyInMeters !== undefined
        ? {
            coordinateUncertaintyInMeters:
              existing.coordinateUncertaintyInMeters,
          }
        : {}),
    };
  }

  return {
    eventDate,
    ...(meta.decimalLatitude !== undefined
      ? { decimalLatitude: meta.decimalLatitude }
      : {}),
    ...(meta.decimalLongitude !== undefined
      ? { decimalLongitude: meta.decimalLongitude }
      : {}),
    ...(meta.coordinateUncertaintyInMeters !== undefined
      ? { coordinateUncertaintyInMeters: meta.coordinateUncertaintyInMeters }
      : {}),
  };
}
