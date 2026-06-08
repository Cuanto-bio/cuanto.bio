import type { DBSchema, IDBPDatabase } from 'idb';
import { openDB } from 'idb';
import type { GpsBbox, GpsTrackPoint } from '$lib/gpx';
import type { Main as AtProtocolTarget } from '$lib/lexicons/bio/cuanto/protocolTarget.defs.js';
import type { Main as AtSurvey } from '$lib/lexicons/bio/cuanto/survey.defs.js';
import type { Main as AtSurveyProtocol } from '$lib/lexicons/bio/cuanto/surveyProtocol.defs.js';
import type { Main as AtOccurrence } from '$lib/lexicons/bio/lexicons/temp/v0-1/occurrence.defs.js';
import type { IncidentalOccurrence } from '$lib/surveys';
import { CUANTO_IDB_VERSION } from './constants';

export type {
  TaxonScope,
  VerbatimScope,
} from '$lib/lexicons/bio/cuanto/protocolTarget.defs.js';
export type { GpsBbox, GpsTrackPoint, IncidentalOccurrence };

export interface Target {
  atUri: string;
  record: AtProtocolTarget;
}

export interface Protocol {
  atUri: string;
  rkey: string;
  handle: string;
  avatarUrl?: string;
  record: AtSurveyProtocol;
  targets: Target[];
  followedAt?: string;
}

export interface CachedProtocol extends Protocol {
  cachedAt: number;
}

export interface Occurrence {
  atUri: string;
  record: AtOccurrence;
  // The canonical protocolTarget URI, resolved server-side from the surveyor's
  // surveyTarget. App-level only (not part of the lexicon record); used to relate
  // occurrences to a protocol's targets.
  protocolTargetUri?: string;
  identification?: {
    scientificName: string;
    vernacularName?: string;
    taxonRank?: string;
  };
}

export interface Survey {
  atUri: string;
  did: string;
  rkey: string;
  handle: string;
  avatarUrl?: string;
  protocolHandle: string;
  protocolRkey: string;
  protocolTitle: string;
  record: AtSurvey;
  occurrences: Occurrence[];
}

export interface CachedSurvey extends Survey {
  cachedAt: number;
}

export interface PendingSurvey {
  id?: number;
  protocolUri: string;
  protocolRkey: string;
  protocolTitle: string;
  locationName: string;
  eventDate: string | null;
  eventDurationValue: number | null;
  eventDurationUnit: string | null;
  surveyorCount?: number | null;
  latitude: string | null;
  longitude: string | null;
  occurrences: {
    surveyTargetUri: string;
    taxonID?: string;
    organismQuantity?: string;
  }[];
  incidentals?: IncidentalOccurrence[];
  gpsTrack?: GpsTrackPoint[];
  gpsBbox?: GpsBbox;
  gpsMode?: 'none' | 'point' | 'bbox' | 'track';
  // 'device' for a live-recorded track, 'uploaded' for a track from a GPX file
  trackSource?: 'device' | 'uploaded';
  publishPoint: boolean;
  publishBbox: boolean;
  publishTrack: boolean;
  createdAt: number;
  complete: boolean;
}

export interface IdbUser {
  did: string;
  handle: string;
  avatarUrl?: string;
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
  'gps-tracks': {
    key: string;
    value: { atUri: string; points: GpsTrackPoint[] };
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
      if (oldVersion < 7) {
        // Record shape changed to embed lexicon records; clear cached stores
        // so stale flat-field entries don't collide with the new shape.
        tx.objectStore('cached-protocols').clear();
        tx.objectStore('followed-protocols').clear();
        tx.objectStore('cached-surveys').clear();
      }
      if (oldVersion < 9) {
        db.createObjectStore('gps-tracks', { keyPath: 'atUri' });
      }
      // v8: occurrence shape changed from {count: number} to {organismQuantity: string}.
      // Data migration is handled lazily in getPendingSurveys() because the upgrade
      // callback is synchronous and cannot await IDB requests.
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

export async function updatePendingSurvey(
  survey: PendingSurvey & { id: number },
): Promise<void> {
  const db = await getDB();
  await db.put('pending-surveys', survey);
}

export async function getPendingSurveyById(
  id: number,
): Promise<PendingSurvey | undefined> {
  const db = await getDB();
  return db.get('pending-surveys', id);
}

// Shape of the PendingSurvey Occurrence in db v7
type LegacyPendingSurveyOccurrence7 = {
  surveyTargetUri: string;
  taxonID?: string;
  count?: number;
  organismQuantity?: string;
};

function migratePendingSurvey(survey: PendingSurvey): PendingSurvey {
  const occs = survey.occurrences as LegacyPendingSurveyOccurrence7[];
  // Lazy migration v7→v8: occurrence count field → organismQuantity
  const needsOccMigration = occs.some((o) => typeof o.count === 'number');
  // Lazy migration: records saved before the complete field was added default to true
  const needsCompleteMigration =
    (survey as { complete?: boolean }).complete === undefined;
  const needsIncidentalsMigration =
    (survey as { incidentals?: IncidentalOccurrence[] }).incidentals ===
    undefined;
  // Lazy migration: publishGeo split into publishPoint/publishBbox/publishTrack.
  // publishGeo=true expands to point+bbox (track defaults off — most revealing,
  // opt-in only). publishGeo=false expands to all three off.
  const legacy = survey as {
    publishGeo?: boolean;
    publishPoint?: boolean;
    publishBbox?: boolean;
    publishTrack?: boolean;
  };
  const needsPublishMigration =
    legacy.publishPoint === undefined ||
    legacy.publishBbox === undefined ||
    legacy.publishTrack === undefined ||
    legacy.publishGeo !== undefined;
  if (
    !needsOccMigration &&
    !needsCompleteMigration &&
    !needsIncidentalsMigration &&
    !needsPublishMigration
  )
    return survey;
  const publishDefault = legacy.publishGeo ?? true;
  const migrated: PendingSurvey = {
    ...survey,
    complete: needsCompleteMigration ? true : survey.complete,
    incidentals: needsIncidentalsMigration ? [] : survey.incidentals,
    publishPoint: legacy.publishPoint ?? publishDefault,
    publishBbox: legacy.publishBbox ?? publishDefault,
    publishTrack: legacy.publishTrack ?? false,
    occurrences: needsOccMigration
      ? occs.map(({ count, ...rest }) => ({
          ...rest,
          organismQuantity:
            rest.organismQuantity ??
            (count !== undefined ? String(count) : undefined),
        }))
      : survey.occurrences,
  };
  delete (migrated as { publishGeo?: boolean }).publishGeo;
  return migrated;
}

export async function getPendingSurveys(): Promise<PendingSurvey[]> {
  const db = await getDB();
  const raw = await db.getAll('pending-surveys');
  const surveys = raw.map(migratePendingSurvey);
  const dirty = surveys.filter((s, i) => s !== raw[i]);
  if (dirty.length > 0) {
    const tx = db.transaction('pending-surveys', 'readwrite');
    await Promise.all([...dirty.map((s) => tx.store.put(s)), tx.done]);
  }
  return surveys;
}

export async function deletePendingSurvey(id: number): Promise<void> {
  const db = await getDB();
  await db.delete('pending-surveys', id);
}

export async function getCachedFollowedProtocols(): Promise<CachedProtocol[]> {
  const db = await getDB();
  const protocols = await db.getAll('followed-protocols');
  // sort by follow date desc
  return protocols.sort((a, b) => {
    if (!a.followedAt || !b.followedAt) return 0;
    return new Date(b.followedAt).getTime() - new Date(a.followedAt).getTime();
  });
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

export async function deleteCachedSurvey(atUri: string): Promise<void> {
  const db = await getDB();
  await db.delete('cached-surveys', atUri);
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
  const surveys = await db.getAll('cached-surveys');
  // sort by created desc
  return surveys.sort(
    (a, b) =>
      new Date(b.record.createdAt).getTime() -
      new Date(a.record.createdAt).getTime(),
  );
}

export async function saveIdbUser(user: IdbUser): Promise<void> {
  const db = await getDB();
  await db.put('user', user, 'current');
}

export async function getIdbUser(): Promise<IdbUser | undefined> {
  const db = await getDB();
  return db.get('user', 'current');
}

export async function saveGpsTrack(
  atUri: string,
  points: GpsTrackPoint[],
): Promise<void> {
  const db = await getDB();
  await db.put('gps-tracks', { atUri, points });
}

export async function getGpsTrack(
  atUri: string,
): Promise<{ atUri: string; points: GpsTrackPoint[] } | undefined> {
  const db = await getDB();
  return db.get('gps-tracks', atUri);
}

export async function clearIdbUser(): Promise<void> {
  const db = await getDB();
  await db.delete('user', 'current');
}

export async function clearIdb(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    [
      'cached-protocols',
      'pending-surveys',
      'followed-protocols',
      'cached-surveys',
      'user',
      'gps-tracks',
    ],
    'readwrite',
  );
  await Promise.all([
    tx.objectStore('cached-protocols').clear(),
    tx.objectStore('pending-surveys').clear(),
    tx.objectStore('followed-protocols').clear(),
    tx.objectStore('cached-surveys').clear(),
    tx.objectStore('user').clear(),
    tx.objectStore('gps-tracks').clear(),
    tx.done,
  ]);
}
