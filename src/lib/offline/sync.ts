import type { Protocol, Survey } from './db';
import { cacheProtocol, cacheSurvey, setCachedFollowedProtocols } from './db';

export async function syncOfflineData(
  fetch: typeof globalThis.fetch,
): Promise<void> {
  // Recorded before the request so setCachedFollowedProtocols can tell if a
  // direct follow/unfollow mutation landed after this request started —
  // meaning this response predates it and must not overwrite it.
  const fetchStartedAt = Date.now();
  try {
    const res = await fetch('/api/sync');
    if (!res.ok) return;
    const { followedProtocols, surveys } = (await res.json()) as {
      followedProtocols: Protocol[];
      surveys: Survey[];
    };
    await Promise.all([
      // Write to followed-protocols (for the /following page IDB read)
      setCachedFollowedProtocols(followedProtocols, fetchStartedAt),
      // Write to cached-protocols (for offline protocol detail + survey creation)
      ...followedProtocols.map(cacheProtocol),
      ...surveys.map(cacheSurvey),
    ]);
  } catch {
    // network error — sync will retry on next boot
  }
}
