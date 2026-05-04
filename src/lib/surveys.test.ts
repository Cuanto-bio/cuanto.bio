import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  buildSurveyTiming,
  calcElapsed,
  formatElapsed,
  validatePastTiming,
} from './surveys';

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

describe('validatePastTiming', () => {
  test('returns no errors when date and duration are valid', () => {
    expect(validatePastTiming('2025-10-12T14:30', '45')).toEqual({
      dateError: null,
      durationError: null,
    });
  });

  test('returns dateError when pastDate is empty', () => {
    const { dateError } = validatePastTiming('', '45');
    expect(dateError).not.toBeNull();
  });

  test('returns durationError when pastDurationMinutes is empty', () => {
    const { durationError } = validatePastTiming('2025-10-12T14:30', '');
    expect(durationError).not.toBeNull();
  });

  test('returns durationError when duration is zero', () => {
    const { durationError } = validatePastTiming('2025-10-12T14:30', '0');
    expect(durationError).not.toBeNull();
  });

  test('returns durationError when duration is not a number', () => {
    const { durationError } = validatePastTiming('2025-10-12T14:30', 'abc');
    expect(durationError).not.toBeNull();
  });
});

describe('buildSurveyTiming', () => {
  const startedAt = new Date('2025-10-12T10:00:00Z').getTime();

  test('now mode uses startedAt for eventDate', () => {
    const { eventDate } = buildSurveyTiming('now', startedAt, 300, '', '');
    expect(eventDate).toBe(new Date(startedAt).toISOString());
  });

  test('now mode rounds elapsedSeconds to minutes, minimum 1', () => {
    expect(
      buildSurveyTiming('now', startedAt, 0, '', '').eventDurationValue,
    ).toBe(1);
    expect(
      buildSurveyTiming('now', startedAt, 90, '', '').eventDurationValue,
    ).toBe(2);
    expect(
      buildSurveyTiming('now', startedAt, 300, '', '').eventDurationValue,
    ).toBe(5);
  });

  test('past mode uses pastDate for eventDate', () => {
    const { eventDate } = buildSurveyTiming(
      'past',
      startedAt,
      0,
      '2025-08-01T09:00',
      '',
    );
    expect(eventDate).toBe(new Date('2025-08-01T09:00').toISOString());
  });

  test('past mode uses pastDurationMinutes for eventDurationValue', () => {
    const { eventDurationValue } = buildSurveyTiming(
      'past',
      startedAt,
      0,
      '2025-08-01T09:00',
      '45',
    );
    expect(eventDurationValue).toBe(45);
  });
});
