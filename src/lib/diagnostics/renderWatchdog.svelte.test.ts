import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { logDiagnostic } from './log';
import { startRenderWatchdog } from './renderWatchdog.svelte';

vi.mock('./log', () => ({ logDiagnostic: vi.fn() }));

const logged = vi.mocked(logDiagnostic);

/**
 * Reproduces the wedge these tests exist for: Svelte schedules every DOM update
 * through `queueMicrotask`, and its task queue only schedules a drain when the
 * queue is empty. A scheduled drain that never runs therefore strands not just
 * that update but every update after it, silently, while timers and state carry
 * on. That is what the survey form hit after the Android wrapper was
 * backgrounded: https://tangled.org/cuanto.bio/cuanto.bio/issues/50
 */
function wedgeFlushPipeline() {
  vi.stubGlobal('queueMicrotask', () => {});
}

// Pulls the millisecond figure back out of a reported message, so a test can
// assert on the duration the diagnostic claims rather than just its wording.
function reportedMs(call: [string, string]): number {
  const match = call[1].match(/\((\d+)ms\)/);
  if (!match) throw new Error(`no duration in message: ${call[1]}`);
  return Number(match[1]);
}

beforeEach(() => {
  // Deliberately leaves queueMicrotask alone: the tests stub it themselves, and
  // faking it would break the very mechanism under test. Date *is* faked, so
  // the durations these diagnostics report are assertable.
  vi.useFakeTimers({
    toFake: [
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
      'Date',
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  logged.mockClear();
});

describe('startRenderWatchdog', () => {
  test('stays quiet while updates keep flushing', async () => {
    const stop = startRenderWatchdog({ intervalMs: 1000, stallBeats: 3 });

    await vi.advanceTimersByTimeAsync(5000);
    stop();

    expect(logged).not.toHaveBeenCalled();
  });

  test('detects a stalled flush pipeline and recovers it', async () => {
    const stop = startRenderWatchdog({ intervalMs: 1000, stallBeats: 3 });
    wedgeFlushPipeline();

    await vi.advanceTimersByTimeAsync(3000);
    stop();

    expect(logged).toHaveBeenCalledExactlyOnceWith(
      'render-recovered',
      expect.stringContaining('3'),
    );
  });

  test('reports how long the stall lasted, not how long it has been watching', async () => {
    const stop = startRenderWatchdog({ intervalMs: 1000, stallBeats: 3 });

    // A long healthy run first: its duration must not end up in the report.
    await vi.advanceTimersByTimeAsync(600_000);
    wedgeFlushPipeline();
    await vi.advanceTimersByTimeAsync(3000);
    stop();

    expect(reportedMs(logged.mock.calls[0])).toBeLessThanOrEqual(3000);
  });

  test('records a stall that returning to the foreground repairs', async () => {
    const stop = startRenderWatchdog({ intervalMs: 1000, stallBeats: 3 });
    wedgeFlushPipeline();
    // Short of the stall threshold, which is the normal case coming back from
    // the background: the repair happens before any beat would have caught it.
    await vi.advanceTimersByTimeAsync(1000);

    document.dispatchEvent(new Event('visibilitychange'));
    stop();

    expect(logged).toHaveBeenCalledExactlyOnceWith(
      'render-recovered',
      expect.stringContaining('foreground'),
    );
  });

  test('reports a repeatedly recovered stall no more than once per cooldown', async () => {
    const stop = startRenderWatchdog({ intervalMs: 1000, stallBeats: 3 });
    // Stays wedged: every flush revives the canary, and the queue strands
    // itself again on the next beat. Without a cooldown this reports every
    // stallBeats forever and evicts the whole ring buffer.
    wedgeFlushPipeline();

    await vi.advanceTimersByTimeAsync(30_000);
    stop();

    expect(logged).toHaveBeenCalledOnce();
  });

  test('reports a stall once when flushing cannot recover it', async () => {
    const stop = startRenderWatchdog({
      intervalMs: 1000,
      stallBeats: 3,
      // A flush that cannot revive the canary stands in for the other shape of
      // this failure: effects stranded dirty in an abandoned batch, which no
      // amount of flushing brings back.
      flush: () => {},
    });
    wedgeFlushPipeline();

    await vi.advanceTimersByTimeAsync(10_000);
    stop();

    expect(logged).toHaveBeenCalledExactlyOnceWith(
      'render-stall',
      expect.stringContaining('did not recover'),
    );
  });

  test('flushes when the app returns to the foreground', () => {
    const flush = vi.fn(flushSync);
    const stop = startRenderWatchdog({ flush });

    document.dispatchEvent(new Event('visibilitychange'));
    stop();

    expect(flush).toHaveBeenCalled();
  });

  test('stops beating once stopped', async () => {
    const flush = vi.fn(flushSync);
    const stop = startRenderWatchdog({
      intervalMs: 1000,
      stallBeats: 3,
      flush,
    });
    wedgeFlushPipeline();
    stop();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(logged).not.toHaveBeenCalled();
  });
});
