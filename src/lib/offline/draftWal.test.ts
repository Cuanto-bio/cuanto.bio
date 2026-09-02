import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PendingSurvey } from './db';
import {
  clearDraftWal,
  DRAFT_WAL_KEY,
  readDraftWal,
  writeDraftWal,
} from './draftWal';
import { fakeLocalStorage } from './fakeLocalStorage';

// The write-ahead log lives in localStorage. The vitest environment is node
// (see vite.config.ts), where localStorage is absent by default — which is also
// the SSR condition draftWal.ts guards against, so the "no storage" tests need
// no setup and the storage tests install a fake.

const payload: PendingSurvey = {
  surveyRkey: 'wal000000000',
  protocolUri: 'at://did:test:1/bio.cuanto.surveyProtocol/p1',
  protocolRkey: 'p1',
  protocolTitle: 'Whatever',
  locationName: 'Backgrounded Meadow',
  eventDate: '2026-08-31T10:00:00.000Z',
  eventDurationValue: null,
  eventDurationUnit: null,
  latitude: null,
  longitude: null,
  occurrences: [{ surveyTargetUri: 'at://did:test:1/surveyTarget/t1' }],
  publishPoint: true,
  publishBbox: true,
  publishTrack: false,
  createdAt: 1_756_000_000_000,
  complete: false,
};

describe('survey draft write-ahead log', () => {
  describe('with localStorage present', () => {
    beforeEach(() => {
      vi.stubGlobal('localStorage', fakeLocalStorage());
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    test('round-trips an entry without an id', () => {
      expect(readDraftWal()).toBeNull();
      writeDraftWal({ payload });
      expect(readDraftWal()).toEqual({ payload });
    });

    test('round-trips an entry with an id', () => {
      writeDraftWal({ id: 7, payload });
      expect(readDraftWal()).toEqual({ id: 7, payload });
    });

    test('writeDraftWal overwrites the previous entry', () => {
      writeDraftWal({ payload });
      writeDraftWal({
        id: 3,
        payload: { ...payload, locationName: 'Later Meadow' },
      });
      expect(readDraftWal()?.id).toBe(3);
      expect(readDraftWal()?.payload.locationName).toBe('Later Meadow');
    });

    test('clearDraftWal removes the entry', () => {
      writeDraftWal({ payload });
      clearDraftWal();
      expect(readDraftWal()).toBeNull();
      expect(localStorage.getItem(DRAFT_WAL_KEY)).toBeNull();
    });

    test('readDraftWal returns null for malformed JSON', () => {
      localStorage.setItem(DRAFT_WAL_KEY, '{not json');
      expect(readDraftWal()).toBeNull();
    });

    test('readDraftWal returns null when the stored value has no payload', () => {
      localStorage.setItem(DRAFT_WAL_KEY, JSON.stringify({ id: 1 }));
      expect(readDraftWal()).toBeNull();
    });

    test('does not throw when localStorage access is denied', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
        removeItem: () => {
          throw new Error('denied');
        },
      });
      expect(() => writeDraftWal({ payload })).not.toThrow();
      expect(readDraftWal()).toBeNull();
      expect(() => clearDraftWal()).not.toThrow();
    });
  });

  describe('without localStorage (SSR / node)', () => {
    test('readDraftWal returns null instead of throwing', () => {
      expect(readDraftWal()).toBeNull();
    });

    test('writeDraftWal is a silent no-op', () => {
      expect(() => writeDraftWal({ payload })).not.toThrow();
    });

    test('clearDraftWal is a silent no-op', () => {
      expect(() => clearDraftWal()).not.toThrow();
    });
  });
});
