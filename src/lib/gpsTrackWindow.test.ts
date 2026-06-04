import { describe, expect, test } from 'vitest';
import {
  type AccumulateOptions,
  accumulate,
  emptyWindow,
  RECORD_INTERVAL_MS,
  type WindowState,
} from './gpsTrackWindow';
import type { GpsTrackPoint } from './gpx';

const t0 = new Date('2026-05-27T10:00:00.000Z').getTime();

function pt(
  dt: number,
  accuracy: number | undefined,
  lat = 37,
  lng = -122,
): GpsTrackPoint {
  return { lat, lng, timestamp: t0 + dt, accuracy };
}

// A window that has already finished warm-up, for exercising steady state.
function steady(windowStart: number, best: GpsTrackPoint): WindowState {
  return {
    windowStart,
    best,
    warmingUp: false,
    warmupRef: best.accuracy ?? Number.POSITIVE_INFINITY,
    warmupStreak: 0,
  };
}

// Short, deterministic warm-up parameters for tests.
const WARMUP: AccumulateOptions = {
  warmupStableFixes: 2,
  warmupImproveM: 5,
  warmupTimeoutMs: 30_000,
};

describe('accumulate — warm-up phase', () => {
  test('the first fix opens a window and emits nothing', () => {
    const { state, emit } = accumulate(emptyWindow(), pt(0, 30), WARMUP);
    expect(emit).toBeNull();
    expect(state.warmingUp).toBe(true);
    expect(state.windowStart).toBe(t0);
    expect(state.best).toEqual(pt(0, 30));
  });

  test('keeps the lowest-accuracy fix while still warming up', () => {
    let s = emptyWindow();
    s = accumulate(s, pt(0, 30), WARMUP).state;
    const r = accumulate(s, pt(1_000, 12), WARMUP);
    expect(r.emit).toBeNull();
    expect(r.state.warmingUp).toBe(true);
    expect(r.state.best).toEqual(pt(1_000, 12));
  });

  test('commits the best fix once accuracy stabilizes', () => {
    let s = emptyWindow();
    s = accumulate(s, pt(0, 10), WARMUP).state; // seed
    s = accumulate(s, pt(1_000, 9), WARMUP).state; // streak 1, best -> 9
    const r = accumulate(s, pt(2_000, 9), WARMUP); // streak 2 -> converged
    expect(r.emit).toEqual(pt(1_000, 9));
    expect(r.state.warmingUp).toBe(false);
  });

  test('resets its streak when accuracy keeps improving past the threshold', () => {
    let s = emptyWindow();
    s = accumulate(s, pt(0, 30), WARMUP).state; // ref 30
    s = accumulate(s, pt(1_000, 20), WARMUP).state; // streak 1
    const r = accumulate(s, pt(2_000, 10), WARMUP); // streak 2, but improved 20m
    expect(r.emit).toBeNull();
    expect(r.state.warmingUp).toBe(true);
    expect(r.state.best).toEqual(pt(2_000, 10));
    expect(r.state.warmupStreak).toBe(0); // streak reset, ref now 10
  });

  test('commits best-so-far at the timeout even if still improving', () => {
    const opts: AccumulateOptions = { ...WARMUP, warmupTimeoutMs: 5_000 };
    let s = emptyWindow();
    s = accumulate(s, pt(0, 30), opts).state;
    s = accumulate(s, pt(2_000, 20), opts).state;
    s = accumulate(s, pt(4_000, 10), opts).state;
    const r = accumulate(s, pt(6_000, 4), opts); // 6s >= 5s timeout
    expect(r.emit).toEqual(pt(6_000, 4));
    expect(r.state.warmingUp).toBe(false);
    // The committed fix was itself the best, so the next window starts empty.
    expect(r.state.best).toBeNull();
  });

  test('seeds the next window with the triggering fix when it is not the best', () => {
    let s = emptyWindow();
    s = accumulate(s, pt(0, 8), WARMUP).state; // best stays 8
    s = accumulate(s, pt(1_000, 20), WARMUP).state; // streak 1, best still 8
    const r = accumulate(s, pt(2_000, 25), WARMUP); // streak 2 -> converged, emit 8
    expect(r.emit).toEqual(pt(0, 8));
    expect(r.state.warmingUp).toBe(false);
    expect(r.state.best).toEqual(pt(2_000, 25)); // next window seeded with cand
    expect(r.state.windowStart).toBe(t0 + 2_000);
  });
});

describe('accumulate — steady state', () => {
  test('an unopened window opens with the first fix without warming up', () => {
    const start: WindowState = {
      windowStart: 0,
      best: null,
      warmingUp: false,
      warmupRef: Number.POSITIVE_INFINITY,
      warmupStreak: 0,
    };
    const r = accumulate(start, pt(0, 12), WARMUP);
    expect(r.emit).toBeNull();
    expect(r.state.warmingUp).toBe(false);
    expect(r.state.best).toEqual(pt(0, 12));
  });

  test('a lower-accuracy candidate within the window replaces best', () => {
    const r = accumulate(steady(t0, pt(0, 18)), pt(3_000, 6), WARMUP);
    expect(r.emit).toBeNull();
    expect(r.state.best).toEqual(pt(3_000, 6));
  });

  test('a higher-accuracy candidate within the window is ignored', () => {
    const r = accumulate(steady(t0, pt(0, 6)), pt(3_000, 18), WARMUP);
    expect(r.emit).toBeNull();
    expect(r.state.best).toEqual(pt(0, 6));
  });

  test('a fix at or past the interval closes the window and emits its best', () => {
    const r = accumulate(
      steady(t0, pt(3_000, 6)),
      pt(RECORD_INTERVAL_MS, 9),
      WARMUP,
    );
    expect(r.emit).toEqual(pt(3_000, 6));
    expect(r.state.windowStart).toBe(t0 + RECORD_INTERVAL_MS);
    expect(r.state.best).toEqual(pt(RECORD_INTERVAL_MS, 9));
  });

  test('undefined accuracy is treated as worst, so a defined fix wins', () => {
    const r = accumulate(steady(t0, pt(0, undefined)), pt(2_000, 40), WARMUP);
    expect(r.state.best).toEqual(pt(2_000, 40));
  });

  test('ties keep the earlier best', () => {
    const r = accumulate(steady(t0, pt(0, 10)), pt(2_000, 10), WARMUP);
    expect(r.state.best).toEqual(pt(0, 10));
  });
});
