import type { DBSchema, IDBPDatabase } from 'idb';
import { openDB } from 'idb';
import { CUANTO_IDB_VERSION } from './constants';

export interface TargetScope {
  $type:
    | 'bio.lexicons.temp.surveyTarget#taxonScope'
    | 'bio.lexicons.temp.surveyTarget#verbatimScope';
}

export interface TaxonScope extends TargetScope {
  taxonID: string;
  taxonRank: string;
  scientificName: string;
}

export interface VerbatimScope extends TargetScope {
  verbatimTargetScope: string;
}

export interface Protocol {
  atUri: string;
  rkey: string;
  title: string;
  description: string;
  handle: string;
  targets: {
    atUri: string;
    scope: TargetScope[];
  }[];
  createdAt?: string;
  requiredFields?: string[];
}

export interface CachedProtocol extends Protocol {
  cachedAt: number;
}

interface BaseSurvey {
  eventDate: string | null;
  eventDurationUnit: string | null;
  eventDurationValue: number | null;
  locationName: string;
  protocolRkey: string;
  protocolTitle: string;
  protocolUri: string;
}

export interface PendingSurvey extends BaseSurvey {
  createdAt: number;
  id?: number;
  latitude: string | null;
  longitude: string | null;
  occurrences: { surveyTargetUri: string; taxonID?: string; count: number }[];
}

export interface Survey extends BaseSurvey {
  atUri: string;
  rkey: string;
  protocolHandle: string;
  handle: string;
  occurrences: CachedOccurrence[];
}

export interface CachedSurvey extends Survey {
  cachedAt: number;
}

export interface CachedOccurrence {
  atUri: string;
  organismQuantity: string | null;
  surveyTargetUri: string | null;
}

export interface IdbUser {
  did: string;
  handle: string;
}

interface CuantoDB extends DBSchema {
  'cached-protocols': {
    key: string;
    value: CachedProtocol;
    indexes: { 'by-rkey': string };
  };
  'pending-surveys': {
    key: number;
    value: PendingSurvey;
    autoIncrement: true;
  };
  'followed-protocols': {
    key: string;
    value: CachedProtocol;
    indexes: { 'by-rkey': string };
  };
  'cached-surveys': {
    key: string;
    value: CachedSurvey;
    indexes: { 'by-rkey': string };
  };
  user: {
    key: 'current';
    value: IdbUser;
  };
}

let _db: IDBPDatabase<CuantoDB> | null = null;

async function getDB(): Promise<IDBPDatabase<CuantoDB>> {
  if (_db) return _db;
  _db = await openDB<CuantoDB>('cuanto', CUANTO_IDB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        db.createObjectStore('cached-protocols', { keyPath: 'atUri' });
        db.createObjectStore('pending-surveys', {
          keyPath: 'id',
          autoIncrement: true,
        });
      }
      if (oldVersion < 2) {
        db.createObjectStore('followed-protocols', { keyPath: 'atUri' });
        db.createObjectStore('cached-surveys', { keyPath: 'atUri' });
        db.createObjectStore('user');
      }
      if (oldVersion < 3) {
        tx.objectStore('cached-protocols').createIndex('by-rkey', 'rkey');
        tx.objectStore('followed-protocols').createIndex('by-rkey', 'rkey');
      }
      if (oldVersion < 4) {
        tx.objectStore('cached-surveys').createIndex('by-rkey', 'rkey');
      }
    },
  });
  return _db;
}

export async function cacheProtocol(protocol: Protocol): Promise<void> {
  const db = await getDB();
  await db.put('cached-protocols', { ...protocol, cachedAt: Date.now() });
}

export async function getCachedProtocolByRkey(
  rkey: string,
): Promise<CachedProtocol | undefined> {
  const db = await getDB();
  const cached = await db.getFromIndex('cached-protocols', 'by-rkey', rkey);
  if (cached) return cached;
  // Fall back to followed-protocols so users who followed but haven't fully synced
  // can still create surveys from the following page without a separate sync step.
  return db.getFromIndex('followed-protocols', 'by-rkey', rkey);
}

export async function getCachedProtocols(): Promise<CachedProtocol[]> {
  const db = await getDB();
  return db.getAll('cached-protocols');
}

export async function savePendingSurvey(
  survey: Omit<PendingSurvey, 'id'>,
): Promise<number> {
  const db = await getDB();
  return db.add('pending-surveys', survey as PendingSurvey);
}

export async function getPendingSurveys(): Promise<PendingSurvey[]> {
  const db = await getDB();
  return db.getAll('pending-surveys');
}

export async function deletePendingSurvey(id: number): Promise<void> {
  const db = await getDB();
  await db.delete('pending-surveys', id);
}

export async function getCachedFollowedProtocols(): Promise<CachedProtocol[]> {
  const db = await getDB();
  return db.getAll('followed-protocols');
}

export async function getCachedFollowedProtocolByRkey(
  rkey: string,
): Promise<CachedProtocol | undefined> {
  const db = await getDB();
  return db.getFromIndex('followed-protocols', 'by-rkey', rkey);
}

export async function setCachedFollowedProtocols(
  protocols: Protocol[],
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('followed-protocols', 'readwrite');
  await tx.store.clear();
  const now = Date.now();
  await Promise.all(
    protocols.map((p) => tx.store.put({ ...p, cachedAt: now })),
  );
  await tx.done;
}

export async function cacheSurvey(survey: Survey): Promise<void> {
  const db = await getDB();
  await db.put('cached-surveys', { ...survey, cachedAt: Date.now() });
}

export async function getCachedSurvey(
  atUri: string,
): Promise<CachedSurvey | undefined> {
  const db = await getDB();
  return db.get('cached-surveys', atUri);
}

export async function getCachedSurveyByRkey(
  rkey: string,
): Promise<CachedSurvey | undefined> {
  const db = await getDB();
  return db.getFromIndex('cached-surveys', 'by-rkey', rkey);
}

// TODO add a fetch method that uses a new index on handle and rkey

export async function getCachedSurveys(): Promise<CachedSurvey[]> {
  const db = await getDB();
  return db.getAll('cached-surveys');
}

export async function saveIdbUser(user: IdbUser): Promise<void> {
  const db = await getDB();
  await db.put('user', user, 'current');
}

export async function getIdbUser(): Promise<IdbUser | undefined> {
  const db = await getDB();
  return db.get('user', 'current');
}

export async function clearIdbUser(): Promise<void> {
  const db = await getDB();
  await db.delete('user', 'current');
}
