import { error, json } from '@sveltejs/kit';
import {
  type BlobRefResponse,
  fetchBlob,
  PdsSessionExpiredError,
  uploadBlob,
} from '$lib/server/pds';
import type { RequestHandler } from './$types';

const GPX_CONTENT_TYPE = 'application/gpx+xml';
const MAX_BYTES = 10_000_000; // ~10 MB

export const GET: RequestHandler = async ({ url }) => {
  const did = url.searchParams.get('did');
  const cid = url.searchParams.get('cid');
  if (!did) throw error(422, 'did query parameter is required');
  if (!cid) throw error(422, 'cid query parameter is required');

  const resp = await fetchBlob(did, cid);
  if (!resp.ok) {
    throw error(resp.status, `PDS blob fetch failed: ${resp.status}`);
  }
  const body = await resp.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': GPX_CONTENT_TYPE,
      // Blob refs are content-addressed (CID), so the bytes never change.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });

  const contentType = request.headers.get('content-type')?.split(';')[0].trim();
  if (contentType !== GPX_CONTENT_TYPE) {
    throw error(422, `Content-Type must be ${GPX_CONTENT_TYPE}`);
  }

  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0) throw error(422, 'Empty body');
  if (buf.byteLength > MAX_BYTES) {
    throw error(413, `GPX exceeds ${MAX_BYTES} bytes`);
  }

  try {
    const blob: BlobRefResponse = await uploadBlob(
      locals.did,
      new Uint8Array(buf),
      GPX_CONTENT_TYPE,
    );
    return json({ blob });
  } catch (err) {
    if (err instanceof PdsSessionExpiredError) {
      return json(
        { error: 'pds_session_expired', message: err.message },
        { status: 401 },
      );
    }
    throw err;
  }
};
