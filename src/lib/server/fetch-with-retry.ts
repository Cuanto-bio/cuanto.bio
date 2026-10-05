const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
// The longest a Retry-After may ask us to wait. Past this, a caller is better
// off with the 429 now than with a request that hangs.
const MAX_DELAY_MS = 10_000;

type FetchFn = typeof fetch;

/**
 * Milliseconds to wait before retrying, from a Retry-After header in either of
 * its forms (delay-seconds or an HTTP date), or null if it's absent or
 * unparseable.
 */
function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  if (/^\d+(\.\d+)?$/.test(header.trim())) return parseFloat(header) * 1000;
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}

/** Resolves after ms, or rejects with the signal's reason if it aborts first. */
function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Wraps fetch with retry logic for 429 responses, honouring Retry-After (but
 * never waiting less than the exponential backoff, so a zero or past-dated
 * Retry-After can't make the retries fire back to back). Returns the 429
 * itself once retries run out, or when Retry-After asks for more than
 * MAX_DELAY_MS. Waiting between retries stops when init.signal aborts.
 */
export async function fetchWithRetry(
  url: string | URL,
  init: RequestInit,
  fetchFn: FetchFn = fetch,
): Promise<Response> {
  let attempt = 0;
  while (true) {
    const resp = await fetchFn(url, init);
    if (resp.status !== 429) return resp;
    if (attempt >= MAX_RETRIES) return resp;

    const delayMs = Math.max(
      retryAfterMs(resp.headers.get('Retry-After')) ?? 0,
      BASE_DELAY_MS * 2 ** attempt,
    );
    if (delayMs > MAX_DELAY_MS) return resp;

    // An unread body keeps its connection checked out
    await resp.body?.cancel();
    await sleep(delayMs, init.signal);
    attempt++;
  }
}
