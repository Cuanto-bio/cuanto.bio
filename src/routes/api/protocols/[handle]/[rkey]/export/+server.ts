import { error } from '@sveltejs/kit';
import { getProtocolDetailByHandleAndRkey } from '$lib/server/db/survey-protocols.js';
import { buildDwcDpArchive } from '$lib/server/dwc-dp.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.did) return new Response(null, { status: 401 });

  const protocol = await getProtocolDetailByHandleAndRkey(
    params.handle,
    params.rkey,
  );
  if (!protocol) error(404, 'Protocol not found');

  const filename = `${params.handle}-${params.rkey}-dwcdp.tar.gz`;
  const stream = buildDwcDpArchive(protocol, params.handle, params.rkey);

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
};
