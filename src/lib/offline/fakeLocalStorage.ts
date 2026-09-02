/**
 * Minimal in-memory Storage stand-in for unit tests.
 *
 * The vitest `server` project runs in node, which has no localStorage. The
 * survey draft write-ahead log and its flush path (`draftWal.ts` /
 * `flushDraftWal` in `db.ts`) both need one. Not imported by app code, so it is
 * tree-shaken out of the bundle.
 */
export function fakeLocalStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
}
