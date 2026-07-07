type Options<T> = {
  /** Fetch results for a trimmed, non-empty query. */
  fetchResults: (query: string) => Promise<T[]>;
  /** Minimum trimmed query length before a search fires. Default 2. */
  minLength?: number;
  /** Debounce delay in ms. Default 300. */
  debounceMs?: number;
  initialQuery?: string;
  /** Reactive online status; when provided, going offline clears results. */
  online?: { value: boolean };
  /** Called when fetchResults rejects. */
  onError?: () => void;
  /** Clear results when fetchResults rejects. Default false. */
  clearResultsOnError?: boolean;
};

/**
 * Shared debounce/fetch/reset logic for the app's several autocomplete
 * inputs (taxa, iNat places, protocols): waits for the query to settle,
 * fetches, and tracks a loading flag. Each caller supplies its own fetch
 * function and the few behaviors that differ between them.
 */
export function useDebouncedSearch<T>({
  fetchResults,
  minLength = 2,
  debounceMs = 300,
  initialQuery = '',
  online,
  onError,
  clearResultsOnError = false,
}: Options<T>) {
  let query = $state(initialQuery);
  let results = $state<T[]>([]);
  let searching = $state(false);

  if (online) {
    $effect(() => {
      if (!online.value) {
        searching = false;
        results = [];
      }
    });
  }

  $effect(() => {
    if (query.trim().length < minLength) {
      results = [];
      return;
    }
    const q = query.trim();
    // Guard every write against a newer query having superseded this one —
    // clearing the timer below only cancels requests that hadn't started
    // yet, not one already in flight when the query changed again, so a
    // slower stale response could otherwise land after a newer, faster one.
    const isCurrent = () => query.trim() === q;
    const timer = setTimeout(async () => {
      searching = true;
      try {
        const fetched = await fetchResults(q);
        if (isCurrent()) results = fetched;
      } catch {
        onError?.();
        if (clearResultsOnError && isCurrent()) results = [];
      } finally {
        if (isCurrent()) searching = false;
      }
    }, debounceMs);
    return () => clearTimeout(timer);
  });

  return {
    get query() {
      return query;
    },
    set query(v: string) {
      query = v;
    },
    get results() {
      return results;
    },
    get searching() {
      return searching;
    },
    reset() {
      query = '';
      results = [];
    },
  };
}
