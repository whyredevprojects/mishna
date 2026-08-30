// ---------------------------------------------------------------------------
// The pure rules around `user_email_prefs`: what a missing/partial row means, what
// an unsubscribe leaves the flags at, and how the `0006` audit columns move.
//
// All storage-free. The SQL that reads and writes the row stays in the callers
// (`@mishna/email-data`'s D1EmailRepository and `apps/server`'s routes) — only the
// *decisions* live here, because they were duplicated across three files and a
// divergent copy is exactly the bug shape that already shipped once
// (`blocksForUser`).
// ---------------------------------------------------------------------------

import { UnsubscribeScope } from './unsubscribe-token';
import { DEFAULT_EMAIL_PREFS, EmailPrefs } from './types';

/**
 * How a user's scheduled emails were last turned off (`0006`'s audit trail): the RFC
 * 8058 machine POST, the confirm page's form, the user's own Settings save, or an
 * admin toggling it for them. See {@link unsubscribeAudit} for when each is written.
 */
export type UnsubscribeVia = 'one-click' | 'link' | 'settings' | 'admin';

/**
 * The raw `user_email_prefs` shape this module reads. Snake-case because it is the
 * D1 row verbatim — every caller already has one in hand, and re-mapping it at each
 * call site is how the two copies of the merge drifted apart in the first place.
 * Extra columns (the audit pair) are ignored.
 */
export interface EmailPrefsRow {
  timezone?: string | null;
  weekly_email_dow?: number | null;
  reminder_email_dow?: number | null;
  weekly_enabled?: number | null;
  reminder_enabled?: number | null;
}

/**
 * A prefs row folded onto {@link DEFAULT_EMAIL_PREFS} — **the** single implementation
 * of that merge.
 *
 * A missing row (`null`/`undefined`) is the common case: `user_email_prefs` is only
 * written when someone saves settings, unsubscribes, or an admin flips a flag, so most
 * participants have no row and must read as "New York, weekly Sunday, reminder
 * Thursday, both on".
 *
 * The flags are deliberately **all-or-nothing on the row**, not per-column: with a row
 * present, `weekly_enabled` is authoritative even when it is `0`, and only a *missing
 * row* falls back to the enabled default. A per-column `?? true` would silently
 * re-enable a user whose column somehow read `NULL` — the one direction of this
 * fallback that mails someone who opted out.
 */
export function mergePrefs(row: EmailPrefsRow | null | undefined): EmailPrefs {
  return {
    timezone: row?.timezone ?? DEFAULT_EMAIL_PREFS.timezone,
    weeklyEmailDow: row?.weekly_email_dow ?? DEFAULT_EMAIL_PREFS.weeklyEmailDow,
    reminderEmailDow:
      row?.reminder_email_dow ?? DEFAULT_EMAIL_PREFS.reminderEmailDow,
    weeklyEnabled: row
      ? row.weekly_enabled === 1
      : DEFAULT_EMAIL_PREFS.weeklyEnabled,
    reminderEnabled: row
      ? row.reminder_enabled === 1
      : DEFAULT_EMAIL_PREFS.reminderEnabled,
  };
}

/**
 * The flags a user's row ends up with after an unsubscribe of the given scope.
 *
 * A `switch` rather than a pair of `!==` tests so that adding a scope to
 * `UnsubscribeScope` without deciding what it turns off is a compile error here,
 * instead of silently behaving like `all`. The caller translates these two booleans
 * into its own column names / bind values — that half is SQL and stays in the app.
 */
export function flagsAfterUnsubscribe(scope: UnsubscribeScope): {
  weeklyEnabled: boolean;
  reminderEnabled: boolean;
} {
  switch (scope) {
    case 'all':
      return { weeklyEnabled: false, reminderEnabled: false };
    case 'weekly':
      return { weeklyEnabled: false, reminderEnabled: true };
    case 'reminder':
      return { weeklyEnabled: true, reminderEnabled: false };
    default: {
      const unhandled: never = scope;
      throw new Error(`unhandled unsubscribe scope: ${String(unhandled)}`);
    }
  }
}

/**
 * `0006`'s audit columns for a prefs write, given the flags the row will *end up*
 * with — or `null` for "don't touch them".
 *
 * Both scheduled emails back on means the user is subscribed again, so the columns
 * are cleared; otherwise the row would read "unsubscribed via one-click" forever
 * while both emails are on, and any later suppression logic keyed on
 * `unsubscribed_at` would wrongly skip a re-subscribed user. Both off is itself an
 * unsubscribe and is recorded with the channel it came through. One on and one off is
 * neither, so the previous record stands.
 */
export function unsubscribeAudit(
  weeklyEnabled: boolean,
  reminderEnabled: boolean,
  via: UnsubscribeVia,
  now: number,
): { at: number | null; via: UnsubscribeVia | null } | null {
  if (weeklyEnabled && reminderEnabled) return { at: null, via: null };
  if (!weeklyEnabled && !reminderEnabled) return { at: now, via };
  return null;
}

/**
 * A **hard** unsubscribe: the flags were last turned off from the *mail* (the RFC 8058
 * one-click POST or the confirm page's form), not from a UI the user or an admin drove.
 *
 * Lives next to {@link unsubscribeAudit} because it only makes sense against that
 * function's contract: `unsubscribed_via` is written only when the resulting row has
 * both flags off (the channel) or both on (cleared) — one-on/one-off leaves the previous
 * record standing. So a user who one-clicked, then had weekly re-enabled by an admin,
 * still reads `'one-click'` while `weekly_enabled = 1`; the caller must therefore pair
 * this with the flag for the kind it's about to send.
 *
 * Takes the raw column value (`string | null`), not a row, so an unknown future channel
 * is simply "not hard" rather than a type error at every call site.
 */
export function isHardUnsubscribe(via: string | null | undefined): boolean {
  return via === 'one-click' || via === 'link';
}
