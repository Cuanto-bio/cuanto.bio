import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// A readwrite transaction opened while the page is hidden can hang forever in
// an iOS WKWebView — no result, no error, no events — and because WebKit
// serializes write transactions per database, that one zombie blocks every
// later write until the app is force-quit. Reads keep working throughout,
// which is what made it so hard to spot. Measured on-device: the culprit was
// our own visibility breadcrumb, written from the `visibilitychange` handler
// at the exact instant the app suspended for the system browser.
// https://tangled.org/cuanto.bio/cuanto.bio/issues/68

let visibility: 'visible' | 'hidden' = 'visible';
let visibilityListeners: Array<() => void> = [];

function setVisibility(next: 'visible' | 'hidden') {
  visibility = next;
  // A copy: a listener may add or remove one while we iterate.
  for (const fn of [...visibilityListeners]) fn();
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  visibility = 'visible';
  visibilityListeners = [];
  vi.stubGlobal('document', {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (type: string, fn: () => void) => {
      if (type === 'visibilitychange') visibilityListeners.push(fn);
    },
    removeEventListener: (type: string, fn: () => void) => {
      if (type === 'visibilitychange')
        visibilityListeners = visibilityListeners.filter((l) => l !== fn);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('diagnostics while hidden', () => {
  test('buffers the entry instead of opening a transaction, and flushes on visible', async () => {
    const { recordDiagnostic, getDiagnostics } = await import('./db');

    setVisibility('hidden');
    await recordDiagnostic('visibility', 'hidden');

    // Nothing written yet: opening the transaction is the whole problem.
    expect(await getDiagnostics()).toHaveLength(0);

    setVisibility('visible');
    await vi.waitFor(async () =>
      expect(await getDiagnostics()).toHaveLength(1),
    );
    const [entry] = await getDiagnostics();
    expect(entry.message).toBe('hidden');
  });

  test('keeps the timestamp from when the entry happened, not when it landed', async () => {
    // The breadcrumb exists to say *when* the app backgrounded, so a flush
    // timestamp would defeat the point.
    const { recordDiagnostic, getDiagnostics } = await import('./db');

    setVisibility('hidden');
    const before = Date.now();
    await recordDiagnostic('visibility', 'hidden');
    const after = Date.now();

    setVisibility('visible');
    await vi.waitFor(async () =>
      expect(await getDiagnostics()).toHaveLength(1),
    );

    const [entry] = await getDiagnostics();
    expect(entry.at).toBeGreaterThanOrEqual(before);
    expect(entry.at).toBeLessThanOrEqual(after);
  });

  test('writes straight through while visible', async () => {
    const { recordDiagnostic, getDiagnostics } = await import('./db');
    await recordDiagnostic('error', 'boom');
    expect(await getDiagnostics()).toHaveLength(1);
  });

  test('flushes buffered breadcrumbs before writes triggered as the app returns', async () => {
    // captureClientDiagnostics keeps its own visibilitychange listener that
    // records a `visible` breadcrumb the instant the app is foregrounded. The
    // buffered `hidden` entry happened first and must keep the lower key, or
    // the ring-buffer trim (which deletes in key order) drops the newer one.
    const { recordDiagnostic, getDiagnostics, cacheProtocol } = await import(
      './db'
    );

    setVisibility('hidden');
    await recordDiagnostic('visibility', 'hidden');
    // A deferred cache write in the same flush: the buffered breadcrumb must
    // not be made to wait behind it.
    await cacheProtocol({ atUri: 'at://x', rkey: 'x', handle: 'd' } as never);

    // Registered after db.ts's flush hook, as the real one is (it runs from a
    // layout mount, well after the db module loads).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible')
        void recordDiagnostic('visibility', 'visible');
    });

    setVisibility('visible');
    await vi.waitFor(async () =>
      expect(await getDiagnostics()).toHaveLength(2),
    );

    const messages = (await getDiagnostics()).map((e) => e.message);
    expect(messages).toEqual(['hidden', 'visible']);
  });
});

describe('cache writes while hidden', () => {
  test('are deferred until visible rather than opening a transaction', async () => {
    const { cacheProtocol, getCachedProtocols } = await import('./db');
    const protocol = {
      atUri: 'at://did:plc:dana/bio.cuanto.surveyProtocol/x',
      rkey: 'x',
      handle: 'dana',
    } as unknown as Parameters<typeof cacheProtocol>[0];

    setVisibility('hidden');
    await cacheProtocol(protocol);
    expect(await getCachedProtocols()).toHaveLength(0);

    setVisibility('visible');
    await vi.waitFor(async () =>
      expect(await getCachedProtocols()).toHaveLength(1),
    );
  });

  test('resolve immediately while hidden so no caller is left awaiting', async () => {
    // Deferring the *promise* would move the hang rather than remove it: a
    // route load awaiting a cache write would block just as it did before.
    const { cacheProtocol } = await import('./db');
    setVisibility('hidden');

    await expect(
      Promise.race([
        cacheProtocol({ atUri: 'at://x', rkey: 'x', handle: 'd' } as never),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('hung')), 500),
        ),
      ]),
    ).resolves.toBeUndefined();
  });

  test('setCachedFollowedProtocols defers its clear+put transaction too', async () => {
    // syncOfflineData fires this un-awaited right after `await fetch('/api/sync')`.
    // Background the app during that fetch and the readwrite transaction would
    // otherwise open while hidden, the exact hang whenVisible exists to stop.
    const { setCachedFollowedProtocols, getCachedFollowedProtocols } =
      await import('./db');
    const protocol = {
      atUri: 'at://did:plc:dana/bio.cuanto.surveyProtocol/x',
      rkey: 'x',
      handle: 'dana',
    } as unknown as Parameters<typeof setCachedFollowedProtocols>[0][number];

    setVisibility('hidden');
    await setCachedFollowedProtocols([protocol]);
    expect(await getCachedFollowedProtocols()).toHaveLength(0);

    setVisibility('visible');
    await vi.waitFor(async () =>
      expect(await getCachedFollowedProtocols()).toHaveLength(1),
    );
  });

  test('a deferred write survives the connection being reset before it flushes', async () => {
    // resetIdbConnection() closes the current handle. A deferred write that
    // closed over that handle would throw InvalidStateError on flush and be
    // swallowed; it must re-resolve the connection when it runs instead. In
    // the wild the reset comes from the withIdbDeadline timeout, which can
    // fire well before the app is foregrounded again.
    const { cacheProtocol, getCachedProtocols, resetIdbConnection } =
      await import('./db');

    setVisibility('hidden');
    await cacheProtocol({ atUri: 'at://x', rkey: 'x', handle: 'd' } as never);

    resetIdbConnection();
    // Let the close settle before the flush, as it would when the deadline
    // fires mid-background rather than in the same tick as the flush.
    await new Promise((resolve) => setTimeout(resolve, 0));

    setVisibility('visible');
    await vi.waitFor(async () =>
      expect(await getCachedProtocols()).toHaveLength(1),
    );
  });
});

describe('data-critical writes while hidden', () => {
  test('pending surveys are written immediately, not deferred', async () => {
    // Autosave exists to save work at exactly the moment the app might be
    // killed. Deferring it would trade a wedged database for lost data, so
    // this one accepts the risk of a hung transaction instead.
    const { savePendingSurvey, getPendingSurveys } = await import('./db');

    setVisibility('hidden');
    await savePendingSurvey({
      protocolRkey: 'x',
      complete: false,
      occurrences: [],
    } as unknown as Parameters<typeof savePendingSurvey>[0]);

    expect(await getPendingSurveys()).toHaveLength(1);
  });
});
