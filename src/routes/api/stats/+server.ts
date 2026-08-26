import { isValidDid } from '@atproto/syntax';
import { error, json } from '@sveltejs/kit';
import { getProtocolStats } from '$lib/server/db/stats';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const protocolsParam = url.searchParams.get('protocols');
  const protocolUris = protocolsParam
    ? protocolsParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const surveyedByParam = url.searchParams.get('surveyedBy');
  if (surveyedByParam && !isValidDid(surveyedByParam)) {
    error(422, 'surveyedBy must be a valid DID');
  }

  // A surveyor alone is enough to scope the query (across every protocol
  // they've used), so protocols is only required when surveyedBy is absent.
  if (protocolUris.length === 0 && !surveyedByParam) {
    error(422, 'protocols or surveyedBy parameter is required');
  }

  const startParam = url.searchParams.get('start');
  const endParam = url.searchParams.get('end');

  let start: Date | undefined;
  let end: Date | undefined;

  if (startParam) {
    start = new Date(startParam);
    if (Number.isNaN(start.getTime())) {
      error(422, 'start must be a valid ISO 8601 datetime');
    }
  }
  if (endParam) {
    end = new Date(endParam);
    if (Number.isNaN(end.getTime())) {
      error(422, 'end must be a valid ISO 8601 datetime');
    }
  }
  if (start && end && start > end) {
    error(422, 'start must not be after end');
  }

  const northParam = url.searchParams.get('bboxNorth');
  const southParam = url.searchParams.get('bboxSouth');
  const eastParam = url.searchParams.get('bboxEast');
  const westParam = url.searchParams.get('bboxWest');
  const bboxParams = [northParam, southParam, eastParam, westParam];
  const bboxPresent = bboxParams.filter((p) => p !== null).length;

  let bbox:
    | { north: number; south: number; east: number; west: number }
    | undefined;

  if (bboxPresent > 0) {
    if (bboxPresent !== 4) {
      error(
        422,
        'all four bbox parameters (bboxNorth, bboxSouth, bboxEast, bboxWest) are required together',
      );
    }
    const north = Number(northParam);
    const south = Number(southParam);
    const east = Number(eastParam);
    const west = Number(westParam);
    if (
      !Number.isFinite(north) ||
      !Number.isFinite(south) ||
      !Number.isFinite(east) ||
      !Number.isFinite(west)
    ) {
      error(422, 'bbox coordinates must be finite numbers');
    }
    if (north < -90 || north > 90 || south < -90 || south > 90) {
      error(422, 'bbox latitude values must be between -90 and 90');
    }
    if (east < -180 || east > 180 || west < -180 || west > 180) {
      error(422, 'bbox longitude values must be between -180 and 180');
    }
    if (north < south) {
      error(422, 'bboxNorth must be greater than or equal to bboxSouth');
    }
    // Antimeridian-crossing boxes (west > east) are not supported; ST_MakeEnvelope
    // would silently return an empty envelope.
    if (west >= east) {
      error(
        422,
        'bboxWest must be less than bboxEast (antimeridian-crossing bboxes are not supported)',
      );
    }
    bbox = { north, south, east, west };
  }

  const stats = await getProtocolStats({
    protocolUris,
    start,
    end,
    bbox,
    surveyedBy: surveyedByParam ?? undefined,
  });
  return json(stats);
};
