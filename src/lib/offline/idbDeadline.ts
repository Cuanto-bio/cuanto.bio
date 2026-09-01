import logger from '$lib/logger';
import { resetIdbConnection } from './db';

const log = logger.child({ component: 'idb-deadline' });

/**
 * How long a caller waits on an IndexedDB operation before giving up on it.
 *
 * A backstop, not the fix: whenVisible in ./db is what stops a write
 * transaction being opened across a suspend in the first place. This exists
 * because a hung IDB promise is indistinguishable from a slow one -- an iOS
 * WKWebView can leave a transaction pending forever with no result, no error,
 * and no events -- so a navigation guard that awaits one would strand the
 * whole app with nothing thrown or logged.
 * https://tangled.org/cuanto.bio/cuanto.bio/issues/68
 *
 * Lives here rather than in the route that uses it because SvelteKit only
 * allows a fixed set of named exports from a +layout.ts / +page.ts, and the
 * tests need this constant.
 */
export const IDB_TIMEOUT_MS = 3000;

/**
 * Awaits an IndexedDB operation, resolving `undefined` if it does not settle
 * within IDB_TIMEOUT_MS and dropping the connection so later calls do not
 * reuse it. `label` names the operation in the timeout log.
 */
export async function withIdbDeadline<T>(
  op: Promise<T>,
  label: string,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      // The plain logger, not logDiagnostic: that persists to the very
      // database we have just concluded is not answering.
      log.warn(
        { label },
        'IndexedDB operation timed out; resetting connection',
      );
      resetIdbConnection();
      resolve(undefined);
    }, IDB_TIMEOUT_MS);
  });
  try {
    return await Promise.race([op, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
