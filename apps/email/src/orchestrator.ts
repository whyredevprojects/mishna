import { EmailJob, localParts, weekStartOnOrBefore } from '@mishna/domain';
import { alreadySent, loadBlocks, loadRecipients, pendingRefs } from './data';
import { weekRefs } from './quota';

// Emails go out at 08:00 in the recipient's own timezone. The cron fires hourly,
// so this matches each zone exactly once per local day.
export const SEND_HOUR = 8;

/**
 * Decide which emails to enqueue given the current instant. Pure with respect to
 * the clock — `now` is passed in (from controller.scheduledTime) so it's testable.
 * Only acts on users for whom it's currently 08:00 local; weekly and reminder both
 * anchor their "week" to the user's weekly-email weekday.
 */
export async function planSends(env: Env, now: Date): Promise<EmailJob[]> {
  const recipients = await loadRecipients(env);
  const jobs: EmailJob[] = [];

  for (const r of recipients) {
    const parts = localParts(now, r.timezone);
    if (parts.hour !== SEND_HOUR) continue;

    const weekStart = weekStartOnOrBefore(parts, r.weeklyEmailDow);

    if (
      r.weeklyEnabled &&
      parts.dow === r.weeklyEmailDow &&
      !(await alreadySent(env, r.userId, 'weekly', weekStart))
    ) {
      jobs.push({ userId: r.userId, kind: 'weekly', weekStart });
    }

    if (
      r.reminderEnabled &&
      parts.dow === r.reminderEmailDow &&
      !(await alreadySent(env, r.userId, 'reminder', weekStart))
    ) {
      // Only remind when something is still unlearned for the week.
      const blocks = await loadBlocks(env, r.userId);
      const pending = await pendingRefs(env, r.userId, weekRefs(blocks, weekStart));
      if (pending.length > 0) {
        jobs.push({ userId: r.userId, kind: 'reminder', weekStart });
      }
    }
  }

  return jobs;
}
