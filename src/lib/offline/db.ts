import type { DBSchema, IDBPDatabase } from 'idb';
import { openDB } from 'idb';
import type { GpsBbox, GpsTrackPoint } from '$lib/gpx';
import type { Main as AtProtocolTarget } from '$lib/lexicons/bio/cuanto/protocolTarget.defs.js';
import type { Main as AtSurvey } from '$lib/lexicons/bio/cuanto/survey.defs.js';
import type { Main as AtSurveyProtocol } from '$lib/lexicons/bio/cuanto/surveyProtocol.defs.js';
import type { Main as AtOccurrence } from '$lib/lexicons/bio/lexicons/temp/v0-1/occurrence.defs.js';
import logger from '$lib/logger';
import type { RemarkInput } from '$lib/remarks';
import type { IncidentalOccurrence } from '$lib/surveys';
import type { TargetFilterState } from '$lib/targets.svelte';
import { generateTid } from '$lib/tid';
import { CUANTO_IDB_VERSION } from './constants';
import { clearDraftWal, readDraftWal } from './draftWal';

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
  lastSurveyAt?: string;
  // Set when the author has deleted this protocol (issue #25). The row (and
  // its title/description) survives deletion so surveys and follows that
  // reference it keep working; this is the signal to show a "deleted"
  // notice instead of treating it as live.
  deletedAt?: string;
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
  // The remark record named by record.occurrenceRemarksID, hydrated
  // server-side like Survey.eventRemark.
  remark?: {
    atUri: string;
    body: string;
    license?: string;
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
  // The bio.lexicons.temp.v0-1.remark record named by record.eventRemarksID,
  // hydrated server-side. App-level only (not part of the survey record):
  // the remark is its own record with its own license so authored prose can be
  // attributed separately from the survey's facts.
  eventRemark?: {
    atUri: string;
    body: string;
    license?: string;
  };
}

export interface CachedSurvey extends Survey {
  cachedAt: number;
}

export interface PendingSurvey {
  id?: number;
  // Client-generated TID used as the survey record's rkey, so a timed-out POST
  // can be retried idempotently (the server putRecords this key instead of
  // creating a fresh one each time). Set at creation; lazy-migrated for older
  // rows in migratePendingSurvey.
  surveyRkey: string;
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
    // The surveyor's remark about this occurrence, uploaded like eventRemark.
    remark?: RemarkInput;
  }[];
  incidentals?: IncidentalOccurrence[];
  gpsTrack?: GpsTrackPoint[];
  gpsBbox?: GpsBbox;
  gpsMode?: 'none' | 'point' | 'bbox' | 'track';
  // 'device' for a live-recorded track, 'uploaded' for a track from a GPX file
  trackSource?: 'device' | 'uploaded';
  // True when a live track was still recording as this draft was saved, so
  // resuming the survey picks recording back up. Absent on drafts saved before
  // this field existed, which resume with recording stopped.
  trackRecording?: boolean;
  publishPoint: boolean;
  publishBbox: boolean;
  publishTrack: boolean;
  // How the target list was sorted and filtered when the draft was saved, so
  // resuming lands on the same view instead of the defaults (#31). Purely a
  // view preference: never uploaded to the PDS.
  targetFilter?: TargetFilterState;
  // The surveyor's remark about the survey, uploaded as a separate remark record.
  // `license` is set only when the surveyor picked one for this remark. Without
  // it the server applies the account default at upload, so a draft queued for
  // days publishes under whatever default is in force when it lands.
  eventRemark?: RemarkInput;
  createdAt: number;
  complete: boolean;
}

export interface IdbUser {
  did: string;
  handle: string;
  avatarUrl?: string;
}

export type DiagnosticKind =
  | 'render-stall'
  | 'render-recovered'
  | 'error'
  | 'rejection'
  | 'visibility';

export interface DiagnosticEntry {
  id?: number;
  at: number;
  kind: DiagnosticKind;
  message: string;
}

// Cap on the diagnostics ring buffer: enough to hold a field session's
// breadcrumbs, small enough that it can never crowd out survey data.
export const MAX_DIAGNOSTICS = 200;

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
  diagnostics: {
    key: number;
    value: DiagnosticEntry;
    autoIncrement: true;
  };
}

let _dbPromise: Promise<IDBPDatabase<CuantoDB>> | null = null;
// Set by lockIdbUntilReload(); nothing in this module instance clears it.
let _lockedUntilReload = false;

function getDB(): Promise<IDBPDatabase<CuantoDB>> {
  if (_lockedUntilReload) {
    return Promise.reject(new Error('IndexedDB is locked after sign-out'));
  }
  if (_dbPromise) return _dbPromise;
  _dbPromise = openDB<CuantoDB>('cuanto', CUANTO_IDB_VERSION, {
    blocked(currentVersion, blockedVersion) {
      // Another tab still holds a connection at an older version, so this
      // open request is waiting on it to close (see `blocking` below).
      logger.warn(
        { currentVersion, blockedVersion },
        'IDB open blocked by a connection at an older version in another tab',
      );
    },
    blocking(currentVersion, blockedVersion, event) {
      // A newer tab wants to open a later version. Close our stale
      // connection so its open request isn't blocked forever, and drop the
      // memoized promise so the next call in this tab reopens at the new
      // version instead of reusing a closed connection.
      logger.warn(
        { currentVersion, blockedVersion },
        'Closing IDB connection to unblock a newer version opened in another tab',
      );
      (event.target as IDBDatabase).close();
      _dbPromise = null;
    },
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
      if (oldVersion < 10) {
        // Lexicon namespace migration changed survey and protocol AT-URIs; clear
        // cached stores so stale old-URI entries don't persist after re-sync.
        tx.objectStore('cached-surveys').clear();
        tx.objectStore('cached-protocols').clear();
        tx.objectStore('followed-protocols').clear();
      }
      if (oldVersion < 11) {
        db.createObjectStore('diagnostics', {
          keyPath: 'id',
          autoIncrement: true,
        });
      }
      // v8: occurrence shape changed from {count: number} to {organismQuantity: string}.
      // Data migration is handled lazily in getPendingSurveys() because the upgrade
      // callback is synchronous and cannot await IDB requests.
    },
  });
  return _dbPromise;
}

/**
 * Whether the page is currently hidden, which on iOS means the WKWebView may
 * be suspended at any moment.
 *
 * Guarded for SSR and for the node test environment, neither of which has a
 * document; both are treated as visible, since neither can be suspended.
 */
function isHidden(): boolean {
  return (
    typeof document !== 'undefined' && document.visibilityState === 'hidden'
  );
}

// Best-effort cache writes held back while the page is hidden, replayed when
// it comes back. See whenVisible. Each receives the database handle when it
// runs, not when it was queued -- see flushDeferredWrites.
type DeferredWrite = (db: IDBPDatabase<CuantoDB>) => Promise<unknown>;
let deferredWrites: DeferredWrite[] = [];
// Diagnostic entries recorded while hidden. Buffered as *entries* rather than
// as deferred writes so each keeps the timestamp of the moment it described.
let bufferedDiagnostics: DiagnosticEntry[] = [];

/**
 * Runs a best-effort cache write, holding it until the page is visible.
 *
 * A readwrite transaction opened while the page is hidden can hang forever in
 * an iOS WKWebView: no result, no error, no events. WebKit serializes write
 * transactions per database, so that single zombie blocks every later write
 * until the app is force-quit, while reads carry on working — which is what
 * made it look like a frozen UI rather than a storage problem.
 * https://tangled.org/cuanto.bio/cuanto.bio/issues/68
 *
 * Resolves immediately when it defers, rather than when the write eventually
 * lands. Deferring the promise instead would just relocate the hang: a route
 * load awaiting a cache write would block exactly as it did before. Callers
 * get fire-and-forget semantics, which is what a cache refresh wants anyway —
 * every store guarded this way is re-fetchable from the server.
 *
 * Deliberately NOT used for pending surveys or GPS tracks. Those exist to
 * survive the app being killed, so dropping a write on the floor until an
 * uncertain future is worse than risking a hung transaction.
 *
 * The write is handed the database when it runs rather than closing over one:
 * a write queued now may not flush until after resetIdbConnection() has torn
 * the current connection down.
 */
async function whenVisible(
  run: (db: IDBPDatabase<CuantoDB>) => Promise<unknown>,
): Promise<void> {
  if (isHidden()) {
    deferredWrites.push(run);
    return;
  }
  await run(await getDB());
}

/** Replays everything held back while hidden. Failures are not retried. */
async function flushDeferredWrites(): Promise<void> {
  // Breadcrumbs first: a visibilitychange listener elsewhere records its own
  // `visible` entry the moment we come back, and the ring-buffer trim deletes
  // in key order assuming that matches time order. The buffered entries are
  // older, so they have to land first.
  const entries = bufferedDiagnostics;
  bufferedDiagnostics = [];
  if (entries.length > 0) await writeDiagnostics(entries);

  const writes = deferredWrites;
  deferredWrites = [];
  if (writes.length === 0) return;
  // One fresh handle for the batch, resolved now -- not whatever each write
  // saw when it was queued, which resetIdbConnection() may since have closed.
  const db = await getDB();
  for (const run of writes) {
    try {
      await run(db);
    } catch {
      // A dropped cache write costs a re-fetch, nothing more.
    }
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushDeferredWrites();
  });
}

/**
 * Drops the memoized connection so the next getDB() opens a fresh one.
 *
 * Paired with the deadline in /app/+layout.ts: if a write ever does hang
 * despite whenVisible, the wedged connection is at least not reused. Measured
 * on-device this did NOT by itself unwedge writes (WebKit serializes them per
 * *database*, so a new connection queues behind the same zombie), so this is
 * hygiene rather than recovery -- whenVisible is what actually prevents the
 * zombie. https://tangled.org/cuanto.bio/cuanto.bio/issues/68
 */
export function resetIdbConnection(): void {
  const pending = _dbPromise;
  _dbPromise = null;
  pending?.then((db) => db.close()).catch(() => {});
}

/**
 * Refuses all further IndexedDB access from this page. For sign-out, right
 * after clearIdb(): sign-out ends in a full-page navigation, but this page
 * keeps running until that navigation commits, with the session still valid
 * server-side. Anything that answers in that window (the offline sync, a
 * cache refresh, a preload's /api/me check) would otherwise write the
 * signed-out user's data straight back, for the next person to sign in on
 * this device to find. The page load that ends sign-out starts a fresh module
 * and with it a fresh, unlocked connection.
 */
export function lockIdbUntilReload(): void {
  _lockedUntilReload = true;
  // Writes held back while hidden would replay into the cleared database.
  deferredWrites = [];
  bufferedDiagnostics = [];
  // Close the connection too, so an operation that already has a handle to
  // it can't start another transaction.
  resetIdbConnection();
}

export async function cacheProtocol(protocol: Protocol): Promise<void> {
  await whenVisible((db) =>
    db.put('cached-protocols', { ...protocol, cachedAt: Date.now() }),
  );
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

let draftWalFlush: Promise<number | undefined> | null = null;

/**
 * Folds a survey draft stashed in the localStorage write-ahead log into
 * `pending-surveys`.
 *
 * SurveyForm's autosave writes to the WAL instead of IndexedDB while the page
 * is hidden, because a readwrite transaction opened in a hidden iOS WKWebView
 * can hang forever and wedge every later write (#68, #69). Replaying it here on
 * the next read of the pending list — or on the next foreground, from the form —
 * lands the draft in IndexedDB so it shows up as in-progress and can be resumed,
 * even after a background kill.
 *
 * Returns the pending-surveys id the draft was folded into, so a still-mounted
 * SurveyForm can adopt it and keep autosaving in place rather than creating a
 * second row.
 *
 * Idempotent: a WAL entry with no id is matched to any existing row by
 * surveyRkey, so a crash between the write here and clearing the WAL cannot
 * create a duplicate. Concurrent callers share one in-flight flush. A WAL entry
 * naming a row that no longer exists is dropped rather than resurrected — that
 * row was deleted deliberately (finished, cancelled, or removed from the list).
 * The WAL is only cleared, and only written back, if it still holds the same
 * entry: a fresh stash landing mid-flush (the app backgrounded again) is not
 * lost, and an entry that finish()/confirmCancel() cleared while the flush was
 * parked on `await getDB()` is not written back over the finalised row.
 *
 * Inert while the page is hidden: this is called on every navigation (via
 * getPendingSurveys in /app/+layout.svelte), and opening the readwrite
 * transaction in a hidden iOS WKWebView is the exact hang #68/#69 avoid. The
 * entry is left for the next flush once the page is visible again.
 * https://tangled.org/cuanto.bio/cuanto.bio/issues/69
 */
export async function flushDraftWal(): Promise<number | undefined> {
  if (draftWalFlush) return draftWalFlush;
  if (isHidden()) return undefined;
  const entry = readDraftWal();
  if (!entry) return undefined;
  const entrySnapshot = JSON.stringify(entry);
  const stillOurs = () => JSON.stringify(readDraftWal()) === entrySnapshot;
  const clearIfUnchanged = () => {
    if (stillOurs()) clearDraftWal();
  };
  draftWalFlush = (async () => {
    try {
      const db = await getDB();
      const { payload } = entry;
      if (entry.id != null) {
        const existing = await db.get('pending-surveys', entry.id);
        if (!existing) {
          // Deleted deliberately while the WAL entry sat unflushed; drop it.
          clearIfUnchanged();
          return undefined;
        }
        // Cleared or overwritten while we awaited the connection: stale now.
        if (!stillOurs()) return undefined;
        await db.put('pending-surveys', { ...payload, id: entry.id });
        clearIfUnchanged();
        return entry.id;
      }
      const match = (await db.getAll('pending-surveys')).find(
        (s) => s.surveyRkey === payload.surveyRkey,
      );
      if (!stillOurs()) return undefined;
      let id: number;
      if (match?.id != null) {
        id = match.id;
        await db.put('pending-surveys', { ...payload, id });
      } else {
        id = await db.add('pending-surveys', payload);
      }
      clearIfUnchanged();
      return id;
    } catch (err) {
      // Leave the WAL in place so the next flush retries; a transient failure
      // (or a dev-tools pause) must not drop field data.
      logger.warn({ err }, 'Failed to flush the survey draft write-ahead log');
      return undefined;
    } finally {
      draftWalFlush = null;
    }
  })();
  return draftWalFlush;
}

export async function getPendingSurveyById(
  id: number,
): Promise<PendingSurvey | undefined> {
  await flushDraftWal();
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
  // Lazy migration: rows saved before idempotent uploads (#13) have no
  // surveyRkey; assign one so the retry key stays stable from here on.
  const needsRkeyMigration =
    (survey as { surveyRkey?: string }).surveyRkey === undefined;
  if (
    !needsOccMigration &&
    !needsCompleteMigration &&
    !needsIncidentalsMigration &&
    !needsPublishMigration &&
    !needsRkeyMigration
  )
    return survey;
  const publishDefault = legacy.publishGeo ?? true;
  const migrated: PendingSurvey = {
    ...survey,
    surveyRkey: needsRkeyMigration ? generateTid() : survey.surveyRkey,
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
  await flushDraftWal();
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

// Tracks the most recent addCachedFollowedProtocol/removeCachedFollowedProtocol
// call, so a slower background sync — started before that mutation but whose
// response resolves after it — can tell its snapshot predates the mutation
// and skip overwriting the store with stale data. Pass the caller's fetch
// start time as `fetchStartedAt` to opt into this check.
let lastFollowMutationAt = 0;

export async function setCachedFollowedProtocols(
  protocols: Protocol[],
  fetchStartedAt?: number,
): Promise<void> {
  if (fetchStartedAt !== undefined && lastFollowMutationAt >= fetchStartedAt) {
    return;
  }
  // syncOfflineData fires this un-awaited straight after `await fetch('/api/sync')`,
  // so the app can background between the fetch resolving and this running --
  // the clear()+put() transaction has to be held until visible like the rest.
  await whenVisible(async (db) => {
    const tx = db.transaction('followed-protocols', 'readwrite');
    await tx.store.clear();
    const now = Date.now();
    await Promise.all(
      protocols.map((p) => tx.store.put({ ...p, cachedAt: now })),
    );
    await tx.done;
  });
}

// Writes a single protocol into the followed-protocols cache without waiting
// on a network round trip, so a follow action shows up immediately if the
// user navigates to the Following list right away (issue: the list otherwise
// stayed stale until reload because the follow-triggered background sync
// could still be in flight).
export async function addCachedFollowedProtocol(
  protocol: Protocol,
): Promise<void> {
  await whenVisible((db) =>
    db.put('followed-protocols', { ...protocol, cachedAt: Date.now() }),
  );
  lastFollowMutationAt = Date.now();
}

export async function removeCachedFollowedProtocol(
  atUri: string,
): Promise<void> {
  await whenVisible((db) => db.delete('followed-protocols', atUri));
  lastFollowMutationAt = Date.now();
}

export async function cacheSurvey(survey: Survey): Promise<void> {
  await whenVisible((db) =>
    db.put('cached-surveys', { ...survey, cachedAt: Date.now() }),
  );
}

export async function deleteCachedSurvey(atUri: string): Promise<void> {
  await whenVisible((db) => db.delete('cached-surveys', atUri));
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
  await whenVisible((db) => db.put('user', user, 'current'));
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

export async function recordDiagnostic(
  kind: DiagnosticKind,
  message: string,
): Promise<void> {
  const entry: DiagnosticEntry = { at: Date.now(), kind, message };
  // The visibility breadcrumb is written from the `visibilitychange` handler,
  // so on iOS it opens a transaction at the precise instant the webview
  // suspends -- measured on-device as the thing that wedged every subsequent
  // write. Buffer the entry (keeping its own timestamp, which is the whole
  // point of the breadcrumb) and let the flush on `visible` persist it.
  if (isHidden()) {
    bufferedDiagnostics.push(entry);
    // A long stint in the background with errors or rejections firing must
    // not grow this without bound; hold the same number the persisted ring
    // buffer does, dropping the oldest first as it does.
    if (bufferedDiagnostics.length > MAX_DIAGNOSTICS)
      bufferedDiagnostics.shift();
    return;
  }
  await writeDiagnostics([entry]);
}

/** Appends entries and trims the ring buffer back to MAX_DIAGNOSTICS. */
async function writeDiagnostics(entries: DiagnosticEntry[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('diagnostics', 'readwrite');
  for (const entry of entries) await tx.store.add(entry);
  // Ring buffer: keys ascend with insertion, so the cursor reaches the oldest
  // rows first and dropping the overflow from the front keeps the newest.
  let excess = (await tx.store.count()) - MAX_DIAGNOSTICS;
  let cursor = excess > 0 ? await tx.store.openCursor() : null;
  while (cursor && excess > 0) {
    await cursor.delete();
    excess -= 1;
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function getDiagnostics(): Promise<DiagnosticEntry[]> {
  const db = await getDB();
  return db.getAll('diagnostics');
}

export async function clearDiagnostics(): Promise<void> {
  const db = await getDB();
  await db.clear('diagnostics');
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
      'diagnostics',
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
    tx.objectStore('diagnostics').clear(),
    tx.done,
  ]);
}
