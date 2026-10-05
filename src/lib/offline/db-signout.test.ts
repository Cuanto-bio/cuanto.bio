import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import type { CachedSurvey } from './db';

// lockIdbUntilReload() leaves the module refusing all IndexedDB access, which
// only a fresh module instance (in the app: the page load that ends sign-out)
// undoes. That's exercised here in its own file, with the module re-imported
// per test, so the lock can't leak into db.test.ts.

beforeEach(() => {
  vi.resetModules();
});

const SURVEY = {
  atUri: 'at://did:test:dana/bio.cuanto.survey/abc',
  rkey: 'abc',
  handle: 'dana',
  protocolRkey: 'proto1',
  record: { createdAt: '2026-01-01T00:00:00.000Z' },
  occurrences: [],
} as unknown as CachedSurvey;

// The old page keeps running between sign-out's clear and the navigation that
// ends it, and a response still in flight (the offline sync, say) used to
// write the signed-out user's data straight back, for the next user to find.
test('a cache write after the sign-out lock does not land', async () => {
  const db = await import('./db');
  await db.cacheSurvey(SURVEY);
  await db.clearIdb();
  db.lockIdbUntilReload();

  await expect(db.cacheSurvey(SURVEY)).rejects.toThrow();

  // What the next page load finds.
  vi.resetModules();
  const reloaded = await import('./db');
  expect(await reloaded.getCachedSurveys()).toHaveLength(0);
});

test('the lock also refuses reads, so nothing renders from a cleared cache', async () => {
  const db = await import('./db');
  db.lockIdbUntilReload();

  await expect(db.getIdbUser()).rejects.toThrow();
});
