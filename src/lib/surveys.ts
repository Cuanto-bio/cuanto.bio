export function validatePastTiming(
  pastDate: string,
  pastDurationMinutes: string,
): { dateError: string | null; durationError: string | null } {
  const dateError = pastDate ? null : 'Survey date is required';
  const dur = parseInt(pastDurationMinutes, 10);
  const durationError =
    !pastDurationMinutes || Number.isNaN(dur) || dur < 1
      ? 'Duration must be at least 1 minute'
      : null;
  return { dateError, durationError };
}

export function buildSurveyTiming(
  mode: 'now' | 'past',
  startedAt: number,
  elapsedSeconds: number,
  pastDate: string,
  pastDurationMinutes: string,
): { eventDate: string; eventDurationValue: number } {
  if (mode === 'past') {
    return {
      eventDate: new Date(pastDate).toISOString(),
      eventDurationValue: parseInt(pastDurationMinutes, 10),
    };
  }
  return {
    eventDate: new Date(startedAt).toISOString(),
    eventDurationValue: Math.max(1, Math.round(elapsedSeconds / 60)),
  };
}

export function calcElapsed(startedAt: number): number {
  return Math.floor((Date.now() - startedAt) / 1000);
}

export function formatElapsed(s: number): string {
  const m = Math.floor(s / 60)
    .toString()
    .padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}
