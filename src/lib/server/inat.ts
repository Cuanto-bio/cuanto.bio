import { fetchWithRetry } from './fetch-with-retry';

const INAT_API_URL = 'https://api.inaturalist.org';
const USER_AGENT = 'cuanto.bio/0.1 (prototype)';

/**
 * Fetches a path (e.g. `/v2/taxa?q=oak`) from the iNaturalist API, retrying
 * 429s with backoff (see fetchWithRetry). A 429 that outlasts the retries
 * comes back as an ordinary response.
 *
 * Pass `retry: false` for keystroke-driven searches: several seconds of backoff
 * there is worse than failing fast, since the user just types again.
 */
export function inatFetch(
  path: string,
  { signal, retry = true }: { signal?: AbortSignal; retry?: boolean } = {},
): Promise<Response> {
  const url = `${INAT_API_URL}${path}`;
  const init: RequestInit = { headers: { 'User-Agent': USER_AGENT }, signal };
  return retry ? fetchWithRetry(url, init) : fetch(url, init);
}
