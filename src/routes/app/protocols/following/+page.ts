import logger from '$lib/logger';
import {
  getCachedFollowedProtocols,
  setCachedFollowedProtocols,
} from '$lib/offline/db';
import type { PageLoad } from './$types';

const log = logger.child({ component: 'app-protocols-following' });

export const load: PageLoad = async ({ fetch }) => {
  const cached = await getCachedFollowedProtocols();
  if (cached.length > 0) {
    fetch('/api/protocols/following')
      .then(async (res) => {
        if (res.ok) await setCachedFollowedProtocols(await res.json());
      })
      .catch((err) => {
        log.warn({ err }, 'Failed to update cached followed protocols');
      });
    return { follows: cached };
  }
  try {
    const res = await fetch('/api/protocols/following');
    if (res.ok) {
      const follows = await res.json();
      await setCachedFollowedProtocols(follows);
      return { follows };
    }
  } catch (err) {
    log.error({ err }, 'Failed to fetch followed protocols');
  }
  return { follows: [] };
};
