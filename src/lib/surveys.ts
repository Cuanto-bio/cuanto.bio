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
