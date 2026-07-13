import type { MishnaRef } from '../models/api.types';
import { IS_HEBREW } from './locale';
import { MESECHTA_HEBREW_NAMES } from './mesechta-hebrew-names';

/** "Berachos 1:1" — the human-readable label for a single mishna. */
export function formatRef(ref: MishnaRef): string {
  return `${ref.mesechta} ${ref.perek}:${ref.mishna}`;
}

/**
 * Locale-aware ref label: Hebrew formatting (mapped mesechta name + פרק/משנה)
 * in the Hebrew build, else the English `formatRef`. The numeric ref stays
 * as-is; only the mesechta name and structure words are translated.
 */
export function formatRefLocalized(ref: MishnaRef): string {
  if (IS_HEBREW) {
    const hebrewName = MESECHTA_HEBREW_NAMES[ref.mesechta] ?? ref.mesechta;
    return formatRefHe(hebrewName, ref.perek, ref.mishna);
  }
  return formatRef(ref);
}

/** Hebrew label for a mishna, e.g. "ברכות פרק 8 משנה 7". */
export function formatRefHe(
  hebrewName: string,
  perek: number,
  mishna: number,
): string {
  return `${hebrewName} פרק ${perek} משנה ${mishna}`;
}

/** A Date as the `YYYY-MM-DD` (UTC) string the assignments API expects. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The Sunday (UTC) on or before `d`, as a `YYYY-MM-DD` week-start key. */
export function sundayOnOrBefore(d: Date): string {
  const x = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  x.setUTCDate(x.getUTCDate() - x.getUTCDay());
  return x.toISOString().slice(0, 10);
}

/** A friendly "Tuesday, June 2, 2026" for display, read in UTC. */
export function formatLongDate(iso: string, locale?: string): string {
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00.000Z` : iso);
  return date.toLocaleDateString(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
