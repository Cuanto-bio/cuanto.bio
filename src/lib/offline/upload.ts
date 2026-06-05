import { generateGpx } from '$lib/gpx';
import { hasUnresolvedIncidentals } from '$lib/surveys';
import type { PendingSurvey } from './db';
import { deletePendingSurvey, getPendingSurveys } from './db';

export class PdsSessionExpiredError extends Error {
  constructor() {
    super('AT Protocol session expired. Please sign in again.');
  }
}

type GpxBlobRef = {
  $type: 'blob';
  ref: { $link: string };
  mimeType: string;
  size: number;
};

export async function uploadGpxBlob(gpxText: string): Promise<GpxBlobRef> {
  const resp = await fetch('/api/blobs/gpx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/gpx+xml' },
    body: new TextEncoder().encode(gpxText),
  });
  if (!resp.ok) {
    if (resp.status === 401) {
      const body = (await resp.json()) as { error?: string };
      if (body.error === 'pds_session_expired')
        throw new PdsSessionExpiredError();
    }
    throw new Error(`GPX upload failed: ${resp.status}`);
  }
  const body = (await resp.json()) as { blob: GpxBlobRef };
  return body.blob;
}

export async function uploadPendingSurvey(
  survey: PendingSurvey,
): Promise<{ surveyUri: string; handle: string }> {
  const {
    gpsTrack,
    trackSource,
    publishPoint,
    publishBbox,
    publishTrack,
    ...rest
  } = survey;

  let track: { gpx: GpxBlobRef; source: 'device' | 'uploaded' } | undefined;
  if (publishTrack && gpsTrack && gpsTrack.length > 0) {
    const gpxText = generateGpx(rest.locationName || 'Survey track', gpsTrack);
    const blob = await uploadGpxBlob(gpxText);
    track = { gpx: blob, source: trackSource ?? 'device' };
  }

  const payload = {
    ...rest,
    latitude: publishPoint ? rest.latitude : null,
    longitude: publishPoint ? rest.longitude : null,
    gpsBbox: publishBbox ? rest.gpsBbox : undefined,
    track,
  };
  const resp = await fetch('/api/surveys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    if (resp.status === 401) {
      const body = (await resp.json()) as { error?: string };
      if (body.error === 'pds_session_expired')
        throw new PdsSessionExpiredError();
    }
    throw new Error(`Upload failed: ${resp.status}`);
  }
  return (await resp.json()) as { surveyUri: string; handle: string };
}

export async function uploadAllPending(): Promise<void> {
  const pending = await getPendingSurveys();
  for (const survey of pending) {
    if (!survey.complete) continue;
    if (hasUnresolvedIncidentals(survey.incidentals ?? [])) continue;
    try {
      await uploadPendingSurvey(survey);
      if (survey.id != null) await deletePendingSurvey(survey.id);
    } catch (err) {
      if (err instanceof PdsSessionExpiredError) throw err;
      // leave in queue; will retry next call
    }
  }
}
