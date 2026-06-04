// ---------------------------------------------------------------------------
// Email scheduling contract + helpers
//
// Shared by apps/server (admin "send now" producer) and apps/email (cron
// orchestrator producer + queue consumer). Pure: timezone math uses the built-in
// `Intl` API, day numbers are computed on UTC dates, so results don't depend on
// the host timezone. No storage, no framework — same discipline as the rest of
// the domain.
// ---------------------------------------------------------------------------

/** Which email a job sends. */
export type EmailKind = 'weekly' | 'reminder';

/**
 * A unit of email work on the `mishna-email` queue. The orchestrator/admin enqueue
 * it; the consumer loads the user's blocks, derives the week's quota from
 * `weekStart`, and sends. Kept minimal so the producer/consumer contract is stable.
 */
export interface EmailJob {
  userId: string;
  kind: EmailKind;
  /** YYYY-MM-DD, user-local: the anchor (start) of the target week. */
  weekStart: string;
}

/** The wall-clock parts of an instant, as seen in a given IANA timezone. */
export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  /** Day of week, 0=Sunday … 6=Saturday. */
  dow: number;
  /** Hour of day, 0-23. */
  hour: number;
}

/** The wall-clock parts of `instant` in IANA `timeZone` (DST-correct). */
export function localParts(instant: Date, timeZone: string): LocalParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  const year = Number(parts['year']);
  const month = Number(parts['month']);
  const day = Number(parts['day']);
  const hour = Number(parts['hour']) % 24; // h23 yields 0-23; guard 24 just in case
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, dow, hour };
}

/** Zero-padded `YYYY-MM-DD`. */
function ymd(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * The most recent occurrence of weekday `dow` (0=Sun … 6=Sat) on or before the
 * local date in `parts`, as `YYYY-MM-DD`. This anchors the 7-day learning "week":
 * both the weekly email and its reminder use the week starting on the user's
 * chosen weekly-email weekday.
 */
export function weekStartOnOrBefore(parts: LocalParts, dow: number): string {
  const base = Date.UTC(parts.year, parts.month - 1, parts.day);
  const back = (parts.dow - dow + 7) % 7;
  const d = new Date(base - back * 86_400_000);
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Parse a `YYYY-MM-DD` week anchor into a UTC-midnight Date for assignment math. */
export function weekStartToDate(weekStart: string): Date {
  return new Date(`${weekStart}T00:00:00.000Z`);
}
