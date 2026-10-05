const POLL_INTERVAL = 15_000;

// Check connectivity by hitting our own ping endpoint
export async function checkConnectivity(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('/api/ping', {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

// Singleton reactive state — one poll loop shared across the whole app.
let isOnline = $state(true);
let initialized = false;

// Awaitable check so the poll loop waits for each result before scheduling
// the next tick — prevents overlapping requests.
async function applyCheck() {
  if (navigator.onLine) {
    isOnline = await checkConnectivity();
  } else {
    isOnline = false;
  }
}

async function pollLoop() {
  await applyCheck();
  setTimeout(pollLoop, POLL_INTERVAL);
}

function initOnlineCheck() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  pollLoop();

  window.addEventListener('online', applyCheck);
  window.addEventListener('offline', () => {
    isOnline = false;
  });
}

export function recheckConnectivity() {
  applyCheck();
}

export function useOnline() {
  initOnlineCheck();
  return {
    get value() {
      return isOnline;
    },
  };
}

// How long a request gets once the ping has already found the server
// unreachable: enough for a server that just came back to answer, short
// enough that a navigation doesn't feel stuck.
export const UNREACHABLE_TIMEOUT_MS = 2000;

/**
 * Wraps a load function's `fetch` so that, once the ping has already found the
 * server unreachable, a request that hangs is given up on after
 * UNREACHABLE_TIMEOUT_MS and rejects with the same TypeError a real network
 * failure throws, sending callers to their offline fallbacks. A server that's
 * down behind a proxy (e.g. a Tailscale funnel) hangs rather than refusing the
 * connection, so without this every /app navigation waited out the full
 * request timeouts before falling back.
 * The request is still sent, because the ping can be up to one poll interval
 * stale: a server that came back answers normally, and its answer marks it
 * reachable again without waiting for the next ping.
 * https://tangled.org/cuanto.bio/cuanto.bio/issues/83
 */
export function failFastWhenUnreachable(fetchFn: typeof fetch): typeof fetch {
  return async (...args) => {
    if (isOnline) return fetchFn(...args);
    const [input, init] = args;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, UNREACHABLE_TIMEOUT_MS);
    // The caller's own signal (e.g. its timeout) still has to abort the
    // request, and still surfaces as the AbortError the caller expects.
    const callerSignal = init?.signal;
    if (callerSignal?.aborted) controller.abort();
    callerSignal?.addEventListener('abort', () => controller.abort(), {
      once: true,
    });
    try {
      const res = await fetchFn(input, { ...init, signal: controller.signal });
      // Any answer from our own server proves it is reachable; a 5xx may be
      // a proxy answering for a server that is still down.
      if (res.status < 500) isOnline = true;
      return res;
    } catch (err) {
      if (timedOut) throw new TypeError('Server is unreachable');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
}
