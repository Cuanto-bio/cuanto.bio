import type { CachedProtocol, CachedSurvey } from './db';
import { cacheProtocol, cacheSurvey, setCachedFollowedProtocols } from './db';

export async function syncOfflineData(
  fetch: typeof globalThis.fetch,
): Promise<void> {
  try {
    const res = await fetch('/api/sync');
    if (!res.ok) return;
    const { followedProtocols, surveys } = (await res.json()) as {
      followedProtocols: Omit<CachedProtocol, 'cachedAt'>[];
      surveys: Omit<CachedSurvey, 'cachedAt'>[];
    };
    await Promise.all([
      // Write to followed-protocols (for the /following page IDB read)
      setCachedFollowedProtocols(followedProtocols),
      // Write to cached-protocols (for offline protocol detail + survey creation)
      ...followedProtocols.map(cacheProtocol),
      ...surveys.map(cacheSurvey),
    ]);
  } catch {
    // network error — sync will retry on next boot
  }
}
