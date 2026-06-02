import type { MishnaRef } from '../models/api.types';

/** "Berachos 1:1" — the human-readable label for a single mishna. */
export function formatRef(ref: MishnaRef): string {
  return `${ref.mesechta} ${ref.perek}:${ref.mishna}`;
}

/** A Date as the `YYYY-MM-DD` (UTC) string the assignments API expects. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A friendly "Tuesday, June 2, 2026" for display, read in UTC. */
export function formatLongDate(iso: string): string {
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00.000Z` : iso);
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
