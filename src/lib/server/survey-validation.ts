export function eventDateIsInFuture(eventDate: string): boolean {
  let normalized = eventDate;
  if (/^\d{4}$/.test(eventDate)) {
    normalized = `${eventDate}-01-01`;
  } else if (/^\d{4}-\d{2}$/.test(eventDate)) {
    normalized = `${eventDate}-01`;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return false;
  const today = new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10) > today;
}
