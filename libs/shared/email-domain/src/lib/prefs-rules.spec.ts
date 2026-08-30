import {
  flagsAfterUnsubscribe,
  isHardUnsubscribe,
  mergePrefs,
  unsubscribeAudit,
} from './prefs-rules';
import { DEFAULT_EMAIL_PREFS } from './types';

const NOW = 1_700_000_000_000;

describe('mergePrefs', () => {
  // This function replaced two byte-for-byte copies of the same merge (the D1
  // repository's `buildCandidate` and apps/server's `buildRecipient`). The matrix
  // below is the contract *both* of them had — a divergence here would mean the bulk
  // send and admin send-now disagree about who has opted out, which is the
  // `blocksForUser` bug shape all over again.

  const fullRow = {
    timezone: 'Asia/Jerusalem',
    weekly_email_dow: 2,
    reminder_email_dow: 5,
    weekly_enabled: 1,
    reminder_enabled: 1,
  };

  it('no row at all reads as the shared defaults', () => {
    // The common case: `user_email_prefs` is only written when someone saves
    // settings, unsubscribes, or an admin flips a flag.
    expect(mergePrefs(null)).toEqual(DEFAULT_EMAIL_PREFS);
    expect(mergePrefs(undefined)).toEqual(DEFAULT_EMAIL_PREFS);
    expect(mergePrefs(null).weeklyEnabled).toBe(true);
    expect(mergePrefs(null).reminderEnabled).toBe(true);
  });

  it('returns a fresh object, so a caller can never mutate the shared default', () => {
    const a = mergePrefs(null);
    a.weeklyEnabled = false;
    expect(DEFAULT_EMAIL_PREFS.weeklyEnabled).toBe(true);
    expect(mergePrefs(null).weeklyEnabled).toBe(true);
  });

  it('a full row wins on every field', () => {
    expect(mergePrefs(fullRow)).toEqual({
      timezone: 'Asia/Jerusalem',
      weeklyEmailDow: 2,
      reminderEmailDow: 5,
      weeklyEnabled: true,
      reminderEnabled: true,
    });
  });

  it('weekly_enabled = 0 turns the weekly off and leaves the reminder alone', () => {
    expect(mergePrefs({ ...fullRow, weekly_enabled: 0 })).toMatchObject({
      weeklyEnabled: false,
      reminderEnabled: true,
    });
  });

  it('reminder_enabled = 0 turns the reminder off and leaves the weekly alone', () => {
    expect(mergePrefs({ ...fullRow, reminder_enabled: 0 })).toMatchObject({
      weeklyEnabled: true,
      reminderEnabled: false,
    });
  });

  it('both 0 is a full opt-out', () => {
    expect(
      mergePrefs({ ...fullRow, weekly_enabled: 0, reminder_enabled: 0 }),
    ).toMatchObject({ weeklyEnabled: false, reminderEnabled: false });
  });

  it('a partial row falls back per field for the schedule, but not for the flags', () => {
    // The admin users list selects only the two flags; the schedule columns it
    // doesn't read must come back as the defaults rather than undefined.
    expect(mergePrefs({ weekly_enabled: 0, reminder_enabled: 1 })).toEqual({
      timezone: DEFAULT_EMAIL_PREFS.timezone,
      weeklyEmailDow: DEFAULT_EMAIL_PREFS.weeklyEmailDow,
      reminderEmailDow: DEFAULT_EMAIL_PREFS.reminderEmailDow,
      weeklyEnabled: false,
      reminderEnabled: true,
    });
    // A row *present* but with a missing/NULL flag reads as off, never as on: the
    // enabled default is for "no row", and the one direction this fallback must not
    // take is mailing somebody whose column didn't say yes.
    expect(mergePrefs({ timezone: 'UTC' })).toMatchObject({
      timezone: 'UTC',
      weeklyEnabled: false,
      reminderEnabled: false,
    });
  });

  it('dow 0 survives (it is Sunday, not "missing")', () => {
    // `??` rather than `||`, or a Sunday weekly would silently become Sunday-by-luck.
    expect(
      mergePrefs({ ...fullRow, weekly_email_dow: 0, reminder_email_dow: 0 }),
    ).toMatchObject({ weeklyEmailDow: 0, reminderEmailDow: 0 });
  });
});

describe('flagsAfterUnsubscribe', () => {
  it('`all` turns both scheduled emails off', () => {
    // Today's only shipping scope: the product decision is that unsubscribing kills
    // both. The other two exist so a granular link can ship without a token change.
    expect(flagsAfterUnsubscribe('all')).toEqual({
      weeklyEnabled: false,
      reminderEnabled: false,
    });
  });

  it('`weekly` turns off only the weekly', () => {
    expect(flagsAfterUnsubscribe('weekly')).toEqual({
      weeklyEnabled: false,
      reminderEnabled: true,
    });
  });

  it('`reminder` turns off only the reminder', () => {
    expect(flagsAfterUnsubscribe('reminder')).toEqual({
      weeklyEnabled: true,
      reminderEnabled: false,
    });
  });
});

describe('unsubscribeAudit', () => {
  it('both on clears the record (this is how a user re-subscribes)', () => {
    // Left set, the row would read "unsubscribed via one-click" while both emails are
    // on, and later suppression keyed on `unsubscribed_at` would skip a live user.
    expect(unsubscribeAudit(true, true, 'settings', NOW)).toEqual({
      at: null,
      via: null,
    });
  });

  it('both off records the channel it came through', () => {
    expect(unsubscribeAudit(false, false, 'one-click', NOW)).toEqual({
      at: NOW,
      via: 'one-click',
    });
    expect(unsubscribeAudit(false, false, 'admin', NOW)).toEqual({
      at: NOW,
      via: 'admin',
    });
  });

  it('one on and one off leaves the previous record standing', () => {
    // Not a subscribe and not an unsubscribe — `null` means "do not touch the audit
    // columns", which is what keeps `isHardUnsubscribe` true after a partial re-enable.
    expect(unsubscribeAudit(true, false, 'settings', NOW)).toBeNull();
    expect(unsubscribeAudit(false, true, 'admin', NOW)).toBeNull();
  });
});

describe('isHardUnsubscribe', () => {
  it('is true only for the two mail-side channels', () => {
    // These are the ones admin "send now" refuses to override: re-mailing somebody
    // who pressed Gmail's one-click button is what earns a spam report.
    expect(isHardUnsubscribe('one-click')).toBe(true);
    expect(isHardUnsubscribe('link')).toBe(true);
  });

  it('is false for a UI-driven off switch, or none at all', () => {
    for (const via of ['settings', 'admin', null, undefined, '', 'ONE-CLICK', 'future']) {
      expect(isHardUnsubscribe(via), String(via)).toBe(false);
    }
  });
});
