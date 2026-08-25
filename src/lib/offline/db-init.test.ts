import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CUANTO_IDB_VERSION } from './constants';

// getDB()'s open/upgrade behavior is exercised here in its own file, isolated
// from db.test.ts's shared singleton `_db`: these tests reach into the module
// cache (vi.resetModules / vi.doMock) to simulate independent open attempts
// and independent tabs against the same physical 'cuanto' database. Each test
// gets a fresh in-memory indexedDB so a version left over from one test (or
// from another test file's real CUANTO_IDB_VERSION) can't collide with the
// next test's version.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.doUnmock('idb');
  vi.doUnmock('./constants');
  vi.resetModules();
});

describe('getDB() concurrent first-callers', () => {
  test('memoizes the in-flight open, not just the resolved value', async () => {
    let openCalls = 0;
    vi.doMock('idb', async () => {
      const actual = await vi.importActual<typeof import('idb')>('idb');
      return {
        ...actual,
        openDB: (...args: Parameters<typeof actual.openDB>) => {
          openCalls++;
          return actual.openDB(...args);
        },
      };
    });

    const { getCachedProtocols, getIdbUser } = await import('./db');

    // Two callers racing before the first openDB() call resolves, e.g. a
    // route load and an unawaited sync both touching IDB on first mount.
    await Promise.all([getCachedProtocols(), getIdbUser()]);

    expect(openCalls).toBe(1);
  });
});

describe('getDB() version upgrades across tabs', () => {
  test('a stale connection is closed so a newer tab is not blocked forever', async () => {
    const tabA = await import('./db');
    // Opens tab A's connection at the real current version and leaves it
    // open, as a second tab would after loading an older build.
    await tabA.getCachedProtocols();

    vi.resetModules();
    vi.doMock('./constants', () => ({
      CUANTO_IDB_VERSION: CUANTO_IDB_VERSION + 1,
    }));
    const tabB = await import('./db');

    // Tab A never closes on its own. Without a `blocking` handler on tab A's
    // connection, tab B's version bump stays blocked forever.
    const outcome = await Promise.race([
      tabB.getCachedProtocols().then(() => 'resolved' as const),
      new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), 2000),
      ),
    ]);

    expect(outcome).toBe('resolved');
  }, 10000);
});
