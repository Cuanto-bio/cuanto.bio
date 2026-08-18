import { flushSync } from 'svelte';
import { logDiagnostic } from './log';

const BEAT_INTERVAL_MS = 1000;
// Three beats of divergence rather than one, because one is the healthy resting
// state: `check()` runs synchronously right after the beat that dirties the
// canary, and Svelte flushes on a microtask, so the copy is always exactly one
// behind when a beat looks at it. Two beats of real divergence is the smallest
// signal that means anything, and three leaves margin for a slow flush.
const STALL_BEATS = 3;
// A stall that a flush keeps repairing can recur every few beats indefinitely.
// Reporting each occurrence would fill the ring buffer with one repeating fact
// and evict the breadcrumbs explaining how it started, so they collapse into at
// most one entry per window.
const REPORT_COOLDOWN_MS = 60_000;

export interface RenderWatchdogOptions {
  intervalMs?: number;
  stallBeats?: number;
  /** Injectable so a test can supply a flush that cannot recover the canary. */
  flush?: () => void;
}

/**
 * Watches for the UI silently detaching from application state.
 *
 * Svelte applies every DOM update through one queue. If that queue is ever
 * left with work and nothing scheduled to drain it, updates stop reaching
 * the screen permanently: handlers still run, timers still fire, state still
 * advances, autosave still writes, and nothing throws. The Android wrapper
 * hit this after being backgrounded mid-survey: the form sat frozen at the
 * elapsed time it was backgrounded at while the track continued to grow. See
 * https://tangled.org/cuanto.bio/cuanto.bio/issues/50
 *
 * The canary is a counter advanced by a timer and copied back out by an
 * effect. Effects share the queue that renders components, so a copy that
 * stops tracking the counter means the UI has stopped tracking state. On
 * detection this flushes synchronously, which drains that queue directly and
 * revives the UI, and records whether that worked, which helps us
 * distinguish between two kinds of failure: a stranded queue versus effects
 * stranded in an abandoned batch.
 */
export function startRenderWatchdog({
  intervalMs = BEAT_INTERVAL_MS,
  stallBeats = STALL_BEATS,
  flush = flushSync,
}: RenderWatchdogOptions = {}): () => void {
  let beat = $state(0);
  let rendered = 0;
  // When the canary last moved, which is what makes a reported duration mean
  // "the UI has been frozen this long" rather than "the watchdog has been up
  // this long". Tracked by watching `rendered` change rather than by waiting
  // for the lag to read zero, which it never does on the beat path.
  let lastRendered = 0;
  let levelAt = Date.now();
  let lastReportAt = 0;

  // No flush here to prime it: the canary starts level (both at zero) and the
  // effect runs on its own before the first beat a second from now. Flushing
  // synchronously would mean doing so from inside the caller's own mount.
  const stopEffects = $effect.root(() => {
    $effect(() => {
      rendered = beat;
    });
  });

  // Flushes, then records what that told us. Order matters: the flush is the
  // repair, so anything worth knowing has to be measured before it happens.
  function repairAndReport(lag: number, what: string) {
    const stalledMs = Date.now() - levelAt;
    flush();
    const recovered = rendered === beat;
    lastReportAt = Date.now();
    logDiagnostic(
      recovered ? 'render-recovered' : 'render-stall',
      `${what}: ${lag} beats behind (${stalledMs}ms); a synchronous flush ` +
        `${recovered ? 'recovered them' : 'did not recover them'}`,
    );
  }

  function check() {
    if (rendered !== lastRendered) {
      lastRendered = rendered;
      levelAt = Date.now();
    }
    const lag = beat - rendered;
    if (lag < stallBeats) return;
    if (lastReportAt !== 0 && Date.now() - lastReportAt < REPORT_COOLDOWN_MS) {
      return;
    }
    repairAndReport(lag, 'DOM updates stopped');
  }

  const beatId = setInterval(() => {
    beat += 1;
    check();
  }, intervalMs);

  function onVisibilityChange() {
    if (document.visibilityState !== 'visible') return;
    // Coming back to the foreground is both when a stall becomes the user's
    // problem and when it is cheapest to fix. Waiting for the next beat is not
    // good enough: a hidden page's timers are throttled hard enough that the
    // next one can be a minute away, and the stall may not even have lasted
    // enough beats to cross the threshold. Any lag at all is real here, since
    // this runs in its own task with every pending flush already drained.
    const lag = beat - rendered;
    if (lag > 0) {
      repairAndReport(
        lag,
        'DOM updates were behind on returning to the foreground',
      );
      return;
    }
    flush();
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    clearInterval(beatId);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    stopEffects();
  };
}
