import type { PendingSurvey } from './db';

/**
 * Write-ahead log for an in-progress survey draft, backed by localStorage.
 *
 * SurveyForm autosaves the current draft to IndexedDB every 10s. On iOS a
 * readwrite transaction opened while the WKWebView is hidden can hang forever
 * and wedge every later write until the app is force-quit (#68). The
 * pending-surveys store is deliberately excluded from `whenVisible()` in
 * `$lib/offline/db`, because deferring a survey write trades a wedged database
 * for lost field data.
 *
 * localStorage is synchronous and has no transaction model, so it cannot hang
 * the same way. While the page is hidden the form writes the draft here
 * instead; `flushDraftWal()` in `$lib/offline/db` folds it back into
 * pending-surveys on the next foreground or the next read of the pending list,
 * so the draft survives even a background kill.
 * https://tangled.org/cuanto.bio/cuanto.bio/issues/69
 */

export const DRAFT_WAL_KEY = 'cuanto:survey-draft-wal';

export interface DraftWalEntry {
  // The pending-surveys row this draft belongs to, when a prior autosave
  // already persisted it while visible. Absent for a draft backgrounded
  // before its first successful IndexedDB write.
  id?: number;
  payload: PendingSurvey;
}

function storage(): Storage | null {
  // Guard SSR and any context without localStorage; the WAL only matters in
  // the client, and it must degrade silently rather than throw.
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readDraftWal(): DraftWalEntry | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(DRAFT_WAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftWalEntry;
    if (!parsed || typeof parsed !== 'object' || !parsed.payload) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeDraftWal(entry: DraftWalEntry): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(DRAFT_WAL_KEY, JSON.stringify(entry));
  } catch {
    // Storage full or denied (private mode / quota). The draft just loses its
    // localStorage safety net; the 10s IndexedDB autosave is still the primary
    // path when the page is visible.
  }
}

export function clearDraftWal(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(DRAFT_WAL_KEY);
  } catch {
    // ignore — a stale entry is folded in idempotently by surveyRkey anyway.
  }
}
