import { logDiagnostic } from './log';

function describeReason(reason: unknown): string {
  if (reason instanceof Error) return reason.stack ?? String(reason);
  if (typeof reason === 'object' && reason !== null) {
    try {
      return JSON.stringify(reason);
    } catch {
      // Circular, or something else JSON can't take. String() at least names
      // the type.
      return String(reason);
    }
  }
  return String(reason);
}

/**
 * Save errors to IndexedDB
 *
 * Uncaught errors and unhandled rejections are the obvious ones. Visibility
 * transitions are here to timestamp backgrounding and foregrounding, so
 * every other log entry can be placed relative to them. The freeze in issue
 * https://tangled.org/cuanto.bio/cuanto.bio/issues/50 began the moment the
 * app was backgrounded, and that was only knowable by comparing timestamps
 * after the fact.
 */
export function captureClientDiagnostics(): () => void {
  const onError = (event: ErrorEvent) => {
    logDiagnostic(
      'error',
      `${event.message} (${event.filename}:${event.lineno}:${event.colno})`,
    );
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    // Prefer the stack, which is the only part that says where this came from.
    // Falling back to JSON keeps rejected plain objects — a fetch or AT Proto
    // error payload, say — from persisting as "[object Object]".
    logDiagnostic('rejection', describeReason(event.reason));
  };
  const onVisibilityChange = () => {
    logDiagnostic('visibility', document.visibilityState);
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
