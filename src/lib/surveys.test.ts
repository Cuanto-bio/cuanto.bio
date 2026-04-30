import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { calcElapsed, formatElapsed } from './surveys';

describe('calcElapsed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('returns 0 when no time has elapsed', () => {
    const start = Date.now();
    expect(calcElapsed(start)).toBe(0);
  });

  test('returns correct seconds after time passes without any interval ticks', () => {
    const start = Date.now();
    vi.advanceTimersByTime(3600_000); // advance 1 hour without any ticks
    expect(calcElapsed(start)).toBe(3600);
  });

  test('returns correct seconds for a partial minute', () => {
    const start = Date.now();
    vi.advanceTimersByTime(90_000);
    expect(calcElapsed(start)).toBe(90);
  });
});

describe('formatElapsed', () => {
  test('formats zero as 00:00', () => {
    expect(formatElapsed(0)).toBe('00:00');
  });

  test('formats 90 seconds as 01:30', () => {
    expect(formatElapsed(90)).toBe('01:30');
  });

  test('formats 3600 seconds as 60:00', () => {
    expect(formatElapsed(3600)).toBe('60:00');
  });
});
