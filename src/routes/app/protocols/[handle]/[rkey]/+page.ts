import { error } from '@sveltejs/kit';
import logger from '$lib/logger';
import {
  cacheProtocol,
  getCachedFollowedProtocolByRkey,
  getCachedProtocols,
  type Protocol,
} from '$lib/offline/db';
import type { PageLoad } from './$types';

const log = logger.child({ component: 'app-protocol-detail' });

function toPageData(
  cachedProtocol: Protocol,
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

export const load: PageLoad = async ({ fetch, params, parent, url }) => {
  const { handle: currentUserHandle } = await parent();
  const updated = url.searchParams.has('updated');

  const findCached = async () => {
    const all = await getCachedProtocols();
    return all.find(
      (p) => p.handle === params.handle && p.rkey === params.rkey,
    );
  };

  const cachedProtocol = await findCached();
  if (cachedProtocol && !updated) {
    // Update the cache if possible
    fetch(`/api/protocols/${params.handle}/${params.rkey}`)
      .then(async (res) => {
        if (res.ok) {
          const data: { protocol: Protocol } = await res.json();
          await cacheProtocol(data.protocol);
        }
      })
      .catch((err) => {
        log.warn({ err }, 'Failed to update protocol cache');
      });
    const cachedFollowedProtocol = await getCachedFollowedProtocolByRkey(
      cachedProtocol.rkey,
    );

    return {
      ...toPageData(
        cachedProtocol,
        !navigator.onLine,
        !!cachedFollowedProtocol,
      ),
      isOwner: cachedProtocol.handle === currentUserHandle,
    };
  }

  try {
    const res = await fetch(`/api/protocols/${params.handle}/${params.rkey}`);
    if (res.ok) {
      const data: { protocol: Protocol } = await res.json();
      await cacheProtocol(data.protocol);
      const cachedFollowedProtocol = await getCachedFollowedProtocolByRkey(
        params.rkey,
      );
      return {
        ...data,
        offline: false,
        isFollowing: !!cachedFollowedProtocol,
        isOwner: data.protocol.handle === currentUserHandle,
      };
    }
    if (res.status === 404) error(404, 'Protocol not found');
  } catch (err) {
    log.error({ err }, 'Failed to fetch protocol');
  }

  // updated=1 but network unavailable — fall back to cache
  if (cachedProtocol) {
    const cachedFollowedProtocol = await getCachedFollowedProtocolByRkey(
      cachedProtocol.rkey,
    );
    return {
      ...toPageData(
        cachedProtocol,
        !navigator.onLine,
        !!cachedFollowedProtocol,
      ),
      isOwner: cachedProtocol.handle === currentUserHandle,
    };
  }

  error(503, 'Unavailable offline');
};
