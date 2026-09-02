import { generateGpx } from '$lib/gpx';
import { hasUnresolvedIncidentals } from '$lib/surveys';
import type { PendingSurvey } from './db';
import { deletePendingSurvey, getPendingSurveys } from './db';

export class PdsSessionExpiredError extends Error {
  constructor() {
    super('AT Protocol session expired. Please sign in again.');
  }
}

// Live session, but missing (or only partially granted) a scope the write needs.
// Mirrors the server class of the same name. Extends PdsSessionExpiredError so
// existing `instanceof PdsSessionExpiredError` catches still route it through the
// re-auth flow; callers that want the sharper "grant one more permission" copy
// narrow with `instanceof PdsScopeInsufficientError`.
export class PdsScopeInsufficientError extends PdsSessionExpiredError {
  constructor() {
    super();
    this.message =
      'Cuanto needs an additional permission. Please sign in again to grant it.';
  }
}

// The two auth failures a survey upload can hit need different alert copy:
// 'expired' -> "sign in again", 'permission' -> "grant one more permission".
// Returns null for anything else (a real upload failure, offline, ...).
export function authIssueFromError(
  err: unknown,
): 'permission' | 'expired' | null {
  // PdsScopeInsufficientError extends PdsSessionExpiredError, so check it first.
  if (err instanceof PdsScopeInsufficientError) return 'permission';
  if (err instanceof PdsSessionExpiredError) return 'expired';
  return null;
}

// Turns a failed /api response into the right error class: 403
// pds_permission_required -> PdsScopeInsufficientError, 401 pds_session_expired
// -> PdsSessionExpiredError, anything else -> a generic Error with `context`.
async function throwUploadError(
  resp: Response,
  context: string,
): Promise<never> {
  const body = (await resp.json().catch(() => ({}))) as { error?: string };
  if (resp.status === 403 && body.error === 'pds_permission_required') {
    throw new PdsScopeInsufficientError();
  }
  if (resp.status === 401 && body.error === 'pds_session_expired') {
    throw new PdsSessionExpiredError();
  }
  throw new Error(`${context}: ${resp.status}`);
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
    await throwUploadError(resp, 'GPX upload failed');
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
    // A local view preference for resuming drafts; nothing to publish.
    targetFilter: _targetFilter,
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
    await throwUploadError(resp, 'Upload failed');
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
