import { isHttpError } from '@sveltejs/kit';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/pds', () => ({
  uploadBlob: vi.fn(),
  fetchBlob: vi.fn(),
  PdsSessionExpiredError: class PdsSessionExpiredError extends Error {
    constructor() {
      super('PDS session expired');
    }
  },
}));

import { fetchBlob, PdsSessionExpiredError, uploadBlob } from '$lib/server/pds';
import { GET, POST } from './+server';

const DID = 'did:test:blobs-gpx';
const FAKE_BLOB = {
  $type: 'blob' as const,
  ref: { $link: 'bafyfake' },
  mimeType: 'application/gpx+xml',
  size: 100,
};

function makeRequest(body: BodyInit | null, contentType: string | null) {
  const headers: Record<string, string> = {};
  if (contentType !== null) headers['Content-Type'] = contentType;
  return new Request('http://localhost/api/blobs/gpx', {
    method: 'POST',
    headers,
    body,
  });
}

async function callPost(args: Parameters<typeof POST>[0]): Promise<Response> {
  try {
    return await POST(args);
  } catch (e) {
    if (isHttpError(e)) {
      return new Response(JSON.stringify({ message: e.body.message }), {
        status: e.status,
      });
    }
    throw e;
  }
}

const validGpx = '<?xml version="1.0"?><gpx version="1.1"></gpx>';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(uploadBlob).mockResolvedValue(FAKE_BLOB);
});

describe('POST /api/blobs/gpx', () => {
  test('returns 401 when not authenticated', async () => {
    const resp = await callPost({
      request: makeRequest(validGpx, 'application/gpx+xml'),
      locals: { did: null },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(401);
    expect(uploadBlob).not.toHaveBeenCalled();
  });

  test('returns 422 when Content-Type is missing', async () => {
    const resp = await callPost({
      request: makeRequest(validGpx, null),
      locals: { did: DID },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(422);
    expect(uploadBlob).not.toHaveBeenCalled();
  });

  test('returns 422 when Content-Type is wrong', async () => {
    const resp = await callPost({
      request: makeRequest(validGpx, 'application/octet-stream'),
      locals: { did: DID },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(422);
    expect(uploadBlob).not.toHaveBeenCalled();
  });

  test('accepts Content-Type with a charset suffix', async () => {
    const resp = await callPost({
      request: makeRequest(validGpx, 'application/gpx+xml; charset=utf-8'),
      locals: { did: DID },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
  });

  test('returns 422 when body is empty', async () => {
    const resp = await callPost({
      request: makeRequest('', 'application/gpx+xml'),
      locals: { did: DID },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(422);
    expect(uploadBlob).not.toHaveBeenCalled();
  });

  test('returns 413 when body exceeds size cap', async () => {
    const oversize = 'a'.repeat(10_000_001);
    const resp = await callPost({
      request: makeRequest(oversize, 'application/gpx+xml'),
      locals: { did: DID },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(413);
    expect(uploadBlob).not.toHaveBeenCalled();
  });

  test('returns { blob } on success', async () => {
    const resp = await callPost({
      request: makeRequest(validGpx, 'application/gpx+xml'),
      locals: { did: DID },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { blob: typeof FAKE_BLOB };
    expect(body.blob).toEqual(FAKE_BLOB);
    expect(uploadBlob).toHaveBeenCalledOnce();
    const [callDid, callBytes, callMime] = vi.mocked(uploadBlob).mock.calls[0];
    expect(callDid).toBe(DID);
    expect(callMime).toBe('application/gpx+xml');
    expect(callBytes.byteLength).toBe(validGpx.length);
  });

  test('returns 401 pds_session_expired when uploadBlob throws PdsSessionExpiredError', async () => {
    vi.mocked(uploadBlob).mockRejectedValueOnce(new PdsSessionExpiredError());
    const resp = await callPost({
      request: makeRequest(validGpx, 'application/gpx+xml'),
      locals: { did: DID },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(401);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe('pds_session_expired');
  });
});

async function callGet(args: Parameters<typeof GET>[0]): Promise<Response> {
  try {
    return await GET(args);
  } catch (e) {
    if (isHttpError(e)) {
      return new Response(JSON.stringify({ message: e.body.message }), {
        status: e.status,
      });
    }
    throw e;
  }
}

describe('GET /api/blobs/gpx', () => {
  test('returns 422 when did is missing', async () => {
    const resp = await callGet({
      url: new URL('http://localhost/api/blobs/gpx?cid=bafy'),
    } as unknown as Parameters<typeof GET>[0]);
    expect(resp.status).toBe(422);
    expect(fetchBlob).not.toHaveBeenCalled();
  });

  test('returns 422 when cid is missing', async () => {
    const resp = await callGet({
      url: new URL(`http://localhost/api/blobs/gpx?did=${DID}`),
    } as unknown as Parameters<typeof GET>[0]);
    expect(resp.status).toBe(422);
    expect(fetchBlob).not.toHaveBeenCalled();
  });

  test('proxies the PDS blob bytes with GPX content-type', async () => {
    const gpx = '<?xml version="1.0"?><gpx></gpx>';
    vi.mocked(fetchBlob).mockResolvedValueOnce(
      new Response(gpx, { status: 200 }),
    );
    const resp = await callGet({
      url: new URL(`http://localhost/api/blobs/gpx?did=${DID}&cid=bafyfake`),
    } as unknown as Parameters<typeof GET>[0]);
    expect(resp.status).toBe(200);
    expect(resp.headers.get('Content-Type')).toBe('application/gpx+xml');
    expect(await resp.text()).toBe(gpx);
    expect(fetchBlob).toHaveBeenCalledWith(DID, 'bafyfake');
  });

  test('returns the PDS status code on upstream error', async () => {
    vi.mocked(fetchBlob).mockResolvedValueOnce(
      new Response('', { status: 404 }),
    );
    const resp = await callGet({
      url: new URL(`http://localhost/api/blobs/gpx?did=${DID}&cid=bafymissing`),
    } as unknown as Parameters<typeof GET>[0]);
    expect(resp.status).toBe(404);
  });
});
