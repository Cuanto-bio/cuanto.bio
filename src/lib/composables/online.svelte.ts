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
