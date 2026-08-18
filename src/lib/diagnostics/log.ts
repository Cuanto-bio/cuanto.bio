import logger from '$lib/logger';
import { type DiagnosticKind, recordDiagnostic } from '$lib/offline/db';

const LEVELS: Record<DiagnosticKind, 'info' | 'warn'> = {
  'render-stall': 'warn',
  'render-recovered': 'warn',
  error: 'warn',
  rejection: 'warn',
  // Not a problem in itself, but the transition every other breadcrumb gets
  // read against.
  visibility: 'info',
};

/**
 * Log to IndexedDB
 *
 * Persisted logs help us debug problems that might be hard to reproduce under
 * instrumented conditions.
 *
 * Never rejects. Diagnostics must not be able to break the thing they watch.
 */
export function logDiagnostic(kind: DiagnosticKind, message: string): void {
  logger[LEVELS[kind]]({ kind }, message);
  recordDiagnostic(kind, message).catch(() => {});
}
