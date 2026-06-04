import type { GpsTrackPoint } from './gpx';

export const RECORD_INTERVAL_MS = 10_000;

// Warm-up (cold start) defaults. Until the first point is committed we run an
// elastic window: keep collecting fixes (tracking best-so-far) and only commit
// once accuracy has stopped meaningfully improving, or a hard timeout elapses.
// The timeout is the safety valve for poor conditions (e.g. under canopy) where
// accuracy may never get good, so we still record a point instead of nothing.
export const WARMUP_TIMEOUT_MS = 45_000;
export const WARMUP_IMPROVE_M = 5;
export const WARMUP_STABLE_FIXES = 3;

export interface WindowState {
  /** Timestamp that opened the current window; 0 means no window is open yet. */
  windowStart: number;
  /** Lowest-accuracy candidate seen so far in the current window. */
  best: GpsTrackPoint | null;
  /** True until the first point is committed (the cold-start warm-up phase). */
  warmingUp: boolean;
  /** Best accuracy at the start of the current convergence streak (warm-up). */
  warmupRef: number;
  /** Fixes elapsed in the current convergence streak (warm-up). */
  warmupStreak: number;
}

export interface AccumulateOptions {
  intervalMs?: number;
  warmupTimeoutMs?: number;
  warmupImproveM?: number;
  warmupStableFixes?: number;
}

export function emptyWindow(): WindowState {
  return {
    windowStart: 0,
    best: null,
    warmingUp: true,
    warmupRef: Number.POSITIVE_INFINITY,
    warmupStreak: 0,
  };
}

// Points may lack accuracy (e.g. resumed or parsed tracks). Treat a missing
// value as the worst possible so any real reading is preferred over it.
function accuracyOf(p: GpsTrackPoint): number {
  return p.accuracy ?? Number.POSITIVE_INFINITY;
}

/**
 * Feed a single fix into the windowing decimator. Returns the next window state
 * and, when a point is committed, the point to record (otherwise `emit` is
 * null).
 *
 * Two phases:
 * - Warm-up (cold start): an elastic first window that commits the best-so-far
 *   only once accuracy converges or `warmupTimeoutMs` elapses.
 * - Steady state: a fixed `intervalMs` window that emits the lowest-accuracy
 *   fix seen in each window, so we capture the better fixes `watchPosition`
 *   pushes between window boundaries rather than whichever lands on the edge.
 */
export function accumulate(
  state: WindowState,
  cand: GpsTrackPoint,
  opts: AccumulateOptions = {},
): { state: WindowState; emit: GpsTrackPoint | null } {
  const intervalMs = opts.intervalMs ?? RECORD_INTERVAL_MS;

  // No window open yet: open one with this fix, staying in the current phase.
  if (state.windowStart === 0 || state.best === null) {
    return {
      state: {
        ...state,
        windowStart: cand.timestamp,
        best: cand,
        warmupRef: accuracyOf(cand),
        warmupStreak: 0,
      },
      emit: null,
    };
  }

  if (state.warmingUp) {
    return warmUp(state, cand, state.best, opts);
  }

  // Steady state: fixed-interval best-of-window.
  if (cand.timestamp - state.windowStart >= intervalMs) {
    return {
      state: { ...state, windowStart: cand.timestamp, best: cand },
      emit: state.best,
    };
  }
  const best = accuracyOf(cand) < accuracyOf(state.best) ? cand : state.best;
  return { state: { ...state, best }, emit: null };
}

function warmUp(
  state: WindowState,
  cand: GpsTrackPoint,
  currentBest: GpsTrackPoint,
  opts: AccumulateOptions,
): { state: WindowState; emit: GpsTrackPoint | null } {
  const warmupTimeoutMs = opts.warmupTimeoutMs ?? WARMUP_TIMEOUT_MS;
  const warmupImproveM = opts.warmupImproveM ?? WARMUP_IMPROVE_M;
  const warmupStableFixes = opts.warmupStableFixes ?? WARMUP_STABLE_FIXES;

  const best = accuracyOf(cand) < accuracyOf(currentBest) ? cand : currentBest;
  let warmupRef = state.warmupRef;
  let warmupStreak = state.warmupStreak + 1;
  let converged = false;
  if (warmupStreak >= warmupStableFixes) {
    // Did best improve by more than the threshold over the last K fixes?
    if (warmupRef - accuracyOf(best) <= warmupImproveM) {
      converged = true;
    } else {
      warmupRef = accuracyOf(best);
      warmupStreak = 0;
    }
  }
  const timedOut = cand.timestamp - state.windowStart >= warmupTimeoutMs;

  if (converged || timedOut) {
    // Commit the warm-up point and hand off to steady-state windowing. If the
    // triggering fix was itself the best, it's the committed point, so start
    // the next window empty to avoid recording it twice; otherwise seed the
    // next window with it (it's a fresh, later fix).
    const seedNext = best === cand ? null : cand;
    return {
      state: {
        windowStart: seedNext ? cand.timestamp : 0,
        best: seedNext,
        warmingUp: false,
        warmupRef: seedNext ? accuracyOf(cand) : Number.POSITIVE_INFINITY,
        warmupStreak: 0,
      },
      emit: best,
    };
  }

  return { state: { ...state, best, warmupRef, warmupStreak }, emit: null };
}
