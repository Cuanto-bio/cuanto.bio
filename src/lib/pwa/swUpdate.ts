// Detects when a new service-worker version has installed and is waiting to
// take over, so the app can prompt the user to reload instead of silently
// running stale JS (issue #4) or forcing a jarring auto-reload (issue #7).
//
// Kept framework-free (no Svelte, no direct `navigator` access) so it runs in
// vitest's node environment: callers inject the registration, a controller
// predicate, and the callback. See swUpdate.test.ts.

// Message type the page posts to a waiting worker to make it activate. The
// service worker listens for this and calls skipWaiting().
export const SKIP_WAITING = 'SKIP_WAITING';

// The subset of ServiceWorker we touch. `postMessage` delivers SKIP_WAITING.
export interface WaitingWorker {
  postMessage(message: unknown): void;
}

// A worker still installing: we watch its state until it reaches 'installed'.
export interface InstallingWorker extends WaitingWorker {
  state: string;
  addEventListener(type: 'statechange', listener: () => void): void;
}

// The subset of ServiceWorkerRegistration we touch.
export interface UpdatableRegistration {
  waiting: WaitingWorker | null;
  installing: InstallingWorker | null;
  addEventListener(type: 'updatefound', listener: () => void): void;
}

// Invokes `onUpdateReady(worker)` once a new worker is installed and waiting to
// activate while an existing worker still controls the page. The worker is
// passed back so the caller can `postMessage({ type: SKIP_WAITING })` when the
// user opts in.
//
// `hasController` distinguishes an update from a first install: on first install
// there is no controller and the new worker activates immediately (never
// "waiting"), so we must not prompt. Only updates, where a controller is already
// present, should surface a prompt.
//
// Three arrival paths are handled:
//   1. a worker already `waiting` when this runs (installed before the page did)
//   2. a worker currently `installing` — wait for it to reach 'installed'
//   3. a future update announced by `updatefound` — same statechange handling
export function watchForUpdates(
  registration: UpdatableRegistration,
  onUpdateReady: (worker: WaitingWorker) => void,
  hasController: () => boolean,
): void {
  if (registration.waiting && hasController()) {
    onUpdateReady(registration.waiting);
  }

  const trackInstalling = (worker: InstallingWorker | null) => {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && hasController()) {
        onUpdateReady(worker);
      }
    });
  };

  trackInstalling(registration.installing);

  registration.addEventListener('updatefound', () => {
    trackInstalling(registration.installing);
  });
}
