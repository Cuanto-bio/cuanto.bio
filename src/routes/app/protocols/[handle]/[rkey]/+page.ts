import { error } from '@sveltejs/kit';
import logger from '$lib/logger';
import {
  type CachedProtocol,
  cacheProtocol,
  getCachedFollowedProtocolByRkey,
  getCachedProtocols,
} from '$lib/offline/db';
import type { PageLoad } from './$types';

const log = logger.child({ component: 'app-protocol-detail' });

function toPageData(
  cachedProtocol: Awaited<ReturnType<typeof getCachedProtocols>>[number],
  offline: boolean,
  isFollowing: boolean,
) {
  return {
    protocol: cachedProtocol,
    handle: cachedProtocol.handle,
    followerCount: 0,
    isFollowing,
    offline,
  };
}

export const load: PageLoad = async ({ fetch, params }) => {
  const findCached = async () => {
    const all = await getCachedProtocols();
    return all.find(
      (p) => p.handle === params.handle && p.rkey === params.rkey,
    );
  };

  const cachedProtocol = await findCached();
  if (cachedProtocol) {
    // Update the cache if possible
    fetch(`/api/protocols/${params.handle}/${params.rkey}`)
      .then(async (res) => {
        if (res.ok) {
          const data: { protocol: CachedProtocol } = await res.json();
          await cacheProtocol(data.protocol);
        }
      })
      .catch((err) => {
        log.warn({ err }, 'Failed to update protocol cache');
      });
    const cachedFollowedProtocol = await getCachedFollowedProtocolByRkey(
      cachedProtocol.rkey,
    );

    return toPageData(
      cachedProtocol,
      !navigator.onLine,
      !!cachedFollowedProtocol,
    );
  }

  try {
    const res = await fetch(`/api/protocols/${params.handle}/${params.rkey}`);
    if (res.ok) {
      const data: { protocol: CachedProtocol } = await res.json();
      await cacheProtocol(data.protocol);
      const cachedFollowedProtocol = await getCachedFollowedProtocolByRkey(
        params.rkey,
      );
      return { ...data, offline: false, isFollowing: !!cachedFollowedProtocol };
    }
    if (res.status === 404) error(404, 'Protocol not found');
  } catch (err) {
    log.error({ err }, 'Failed to fetch protocol');
  }

  error(503, 'Unavailable offline');
};
