import logger from '$lib/logger';
import {
  getCachedFollowedProtocols,
  type Protocol,
  setCachedFollowedProtocols,
} from '$lib/offline/db';
import type { PageLoad } from './$types';

const log = logger.child({ component: 'app-protocols-following' });

export const load: PageLoad = async ({ fetch }) => {
  const cached = await getCachedFollowedProtocols();
  if (cached.length > 0) {
    // Recorded before the request so setCachedFollowedProtocols can tell if
    // a direct follow/unfollow mutation landed after this request started —
    // meaning this response predates it and must not overwrite it.
    const fetchStartedAt = Date.now();
    fetch('/api/protocols/following')
      .then(async (res) => {
        if (res.ok) {
          const follows = (await res.json()) as Protocol[];
          await setCachedFollowedProtocols(follows, fetchStartedAt);
        }
      })
      .catch((err) => {
        log.warn({ err }, 'Failed to update cached followed protocols');
      });
    return { follows: cached };
  }
  const fetchStartedAt = Date.now();
  try {
    const res = await fetch('/api/protocols/following');
    if (res.ok) {
      const follows = (await res.json()) as Protocol[];
      await setCachedFollowedProtocols(follows, fetchStartedAt);
      return { follows };
    }
  } catch (err) {
    log.error({ err }, 'Failed to fetch followed protocols');
  }
  return { follows: [] };
};
