import { error } from '@sveltejs/kit';
import logger from '$lib/logger';
import {
  cacheProtocol,
  getCachedFollowedProtocolByRkey,
  getCachedProtocols,
  type Protocol,
} from '$lib/offline/db';
import type { ProtocolActivity } from '$lib/server/db/protocol-activity';
import type { FollowerPreview } from '$lib/server/db/protocol-follows';
import type { PageLoad } from './$types';

const log = logger.child({ component: 'app-protocol-detail' });

interface ProtocolApiResponse {
  protocol: Protocol;
  followerCount: number;
  followerPreview: FollowerPreview[];
  activity?: ProtocolActivity;
}

function toPageData(
  cachedProtocol: Protocol,
  offline: boolean,
  isFollowing: boolean,
) {
  return {
    protocol: cachedProtocol,
    handle: cachedProtocol.handle,
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
    // Render the cached protocol immediately and stream fresh activity,
    // follower count, and offline status in once the network fetch settles
    // (it also refreshes the cache). The follower count is never cached or
    // guessed — it's either this fetch's live value or nothing (while
    // pending or offline), since a stale count is worse than no count.
    // Offline status is determined the same way: from whether this fetch
    // actually reached the server, not from navigator.onLine, which can
    // report "online" even when real connectivity is down (e.g. a broken
    // VPN) — exactly the gap the top-level "You're offline" banner's ping
    // check avoids.
    const fresh = fetch(`/api/protocols/${params.handle}/${params.rkey}`)
      .then(async (res) => {
        if (!res.ok) return { data: undefined, offline: false };
        const data: ProtocolApiResponse = await res.json();
        await cacheProtocol(data.protocol);
        return { data, offline: false };
      })
      .catch((err) => {
        log.warn({ err }, 'Failed to update protocol cache');
        return { data: undefined, offline: true };
      });
    const cachedFollowedProtocol = await getCachedFollowedProtocolByRkey(
      cachedProtocol.rkey,
    );

    return {
      // `false` here is a placeholder immediately superseded by the `offline`
      // key below — kept as a real argument only because toPageData is
      // shared with the fallback branch, which has no fetch to derive it from.
      ...toPageData(cachedProtocol, false, !!cachedFollowedProtocol),
      isOwner: cachedProtocol.handle === currentUserHandle,
      activity: fresh.then((r) => r.data?.activity),
      followerCount: fresh.then((r) => r.data?.followerCount),
      followerPreview: fresh.then((r) => r.data?.followerPreview),
      offline: fresh.then((r) => r.offline),
    };
  }

  // Tracks whether the fetch itself failed to reach the server (a real
  // network error), as opposed to reaching it and getting an error response
  // — more accurate than navigator.onLine for the offline-fallback path
  // below, and known synchronously since we just made this exact request.
  let fetchFailed = false;
  try {
    const res = await fetch(`/api/protocols/${params.handle}/${params.rkey}`);
    if (res.ok) {
      const data: ProtocolApiResponse = await res.json();
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
    fetchFailed = true;
    log.error({ err }, 'Failed to fetch protocol');
  }

  // updated=1 but network unavailable — fall back to cache
  if (cachedProtocol) {
    const cachedFollowedProtocol = await getCachedFollowedProtocolByRkey(
      cachedProtocol.rkey,
    );
    return {
      ...toPageData(cachedProtocol, fetchFailed, !!cachedFollowedProtocol),
      isOwner: cachedProtocol.handle === currentUserHandle,
    };
  }

  error(503, 'Unavailable offline');
};
