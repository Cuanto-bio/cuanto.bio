import { didFromAtUri } from '$lib/atUri';
import { type GpsTrackPoint, parseGpx } from '$lib/gpx';
import logger from '$lib/logger';
import { getGpsTrack, type Survey } from './db';

export type LoadedTrack = {
  points: GpsTrackPoint[];
  source: 'local' | 'published';
};

// Load a survey's GPS track points for display. Prefers a locally-stored track
// (IndexedDB, for surveys authored on this device), otherwise fetches and parses
// the published GPX blob. Returns null when the survey has no track.
export async function loadSurveyTrack(
  survey: Survey,
): Promise<LoadedTrack | null> {
  const stored = await getGpsTrack(survey.atUri);
  if (stored && stored.points.length > 0) {
    return { points: stored.points, source: 'local' };
  }

  const published = survey.record.track;
  if (!published) return null;
  const did = didFromAtUri(survey.atUri);
  const gpxCid = (published.gpx as { ref?: { $link?: string } }).ref?.$link;
  if (!did || !gpxCid) return null;

  try {
    const resp = await fetch(
      `/api/blobs/gpx?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(gpxCid)}`,
    );
    if (!resp.ok) {
      logger.error(
        { status: resp.status },
        'Failed to fetch published GPS track',
      );
      return null;
    }
    const points = parseGpx(await resp.text());
    return points.length > 0 ? { points, source: 'published' } : null;
  } catch (err) {
    logger.error({ err }, 'Failed to load published GPS track');
    return null;
  }
}
