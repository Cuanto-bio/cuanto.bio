import logger from '$lib/logger';
import {
  cacheProtocol,
  getCachedProtocols,
  type Protocol,
} from '$lib/offline/db';
import type { PageLoad } from './$types';

const log = logger.child({ component: 'app-protocols-list' });

// Cache-first, mirroring src/routes/app/protocols/[handle]/[rkey]/+page.ts:
// render whatever we have immediately and let the network refresh it. This
// route previously loaded through a +page.server.ts that queried Postgres
// directly, so despite `ssr = false` it round-tripped to our server on every
// navigation and had no offline story at all.
export const load: PageLoad = async ({ fetch }) => {
  const cached = await getCachedProtocols();

  const fresh = fetch('/api/protocols')
    .then(async (res) => {
      if (!res.ok) return undefined;
      const protocols: Protocol[] = await res.json();
      await Promise.all(protocols.map(cacheProtocol));
      return protocols;
    })
    .catch((err) => {
      // A thrown fetch means we never reached the server. The page keeps the
      // cached list on screen; the online composable drives any offline UI.
      log.warn({ err }, 'Failed to load protocols');
      return undefined;
    });

  if (cached.length > 0) {
    return {
      protocols: cached,
      // Streamed: the page renders from cache and swaps in the fresh list when
      // it lands, rather than blocking on the network.
      freshProtocols: fresh,
    };
  }

  // Nothing cached, so there is nothing to render until the fetch settles.
  const settled = await fresh;
  return {
    protocols: settled ?? [],
    freshProtocols: Promise.resolve(undefined),
  };
};
