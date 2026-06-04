import { EmailKind, localParts, weekStartOnOrBefore } from '@mishna/domain';
import {
  alreadySentSet,
  loadBlocksFor,
  loadCandidates,
  loadCompletedFor,
  loadEmailsFor,
  refKey,
} from './data';
import { PreparedEmail } from './sender';
import { weekRefs } from './quota';

// Emails go out at 08:00 in the recipient's own timezone. The cron fires hourly,
// so this matches each zone exactly once per local day.
export const SEND_HOUR = 8;

/** A (user, kind, week) tuple due at the send hour, before dedup/resolution. */
interface Candidacy {
  userId: string;
  kind: EmailKind;
  weekStart: string;
}

/**
 * Decide which emails to send given the current instant, fully resolved (address +
 * the mishnayot to render) so the sender does no per-user DB reads. Pure with respect
 * to the clock — `now` is passed in (from the cron's scheduledTime) so it's testable.
 *
 * All reads are batched: the per-user N+1 of the naive version (dedup, blocks,
 * completions, emails per user) is collapsed into a handful of `IN (...)` queries, so
 * a run stays well inside the per-invocation subrequest budget no matter how many
 * users are due in one hour. Only acts on users for whom it's currently 08:00 local;
 * weekly and reminder both anchor their "week" to the user's weekly-email weekday.
 */
export async function planSends(env: Env, now: Date): Promise<PreparedEmail[]> {
  // 1. Who is at 08:00 local, and which (kind, week) do they qualify for?
  const candidates = await loadCandidates(env);
  const due: Candidacy[] = [];
  for (const c of candidates) {
    const parts = localParts(now, c.timezone);
    if (parts.hour !== SEND_HOUR) continue;
    const weekStart = weekStartOnOrBefore(parts, c.weeklyEmailDow);
    if (c.weeklyEnabled && parts.dow === c.weeklyEmailDow) {
      due.push({ userId: c.userId, kind: 'weekly', weekStart });
    }
    if (c.reminderEnabled && parts.dow === c.reminderEmailDow) {
      due.push({ userId: c.userId, kind: 'reminder', weekStart });
    }
  }
  if (due.length === 0) return [];

  // 2. Drop ones already sent this week (one batched email_log read).
  const dueUserIds = [...new Set(due.map((d) => d.userId))];
  const sinceWeek = due.reduce(
    (min, d) => (d.weekStart < min ? d.weekStart : min),
    due[0].weekStart,
  );
  const sent = await alreadySentSet(env, dueUserIds, sinceWeek);
  const live = due.filter(
    (d) => !sent.has(`${d.userId}|${d.kind}|${d.weekStart}`),
  );
  if (live.length === 0) return [];

  // 3. Resolve blocks + completions + addresses for the survivors (batched).
  const liveUserIds = [...new Set(live.map((d) => d.userId))];
  const reminderUserIds = [
    ...new Set(live.filter((d) => d.kind === 'reminder').map((d) => d.userId)),
  ];
  const [blocksByUser, completedByUser, emailByUser] = await Promise.all([
    loadBlocksFor(env, liveUserIds),
    reminderUserIds.length
      ? loadCompletedFor(env, reminderUserIds)
      : Promise.resolve(new Map<string, Set<string>>()),
    loadEmailsFor(env, liveUserIds),
  ]);

  // 4. Build the prepared sends. Skip users with no address, and reminders with
  //    nothing still unlearned for the week.
  const prepared: PreparedEmail[] = [];
  for (const d of live) {
    const to = emailByUser.get(d.userId);
    if (!to) continue;
    const refs = weekRefs(blocksByUser.get(d.userId) ?? [], d.weekStart);
    if (d.kind === 'weekly') {
      prepared.push({ userId: d.userId, kind: 'weekly', weekStart: d.weekStart, to, refs });
      continue;
    }
    const done = completedByUser.get(d.userId) ?? new Set<string>();
    const pending = refs.filter((r) => !done.has(refKey(r)));
    if (pending.length > 0) {
      prepared.push({
        userId: d.userId,
        kind: 'reminder',
        weekStart: d.weekStart,
        to,
        refs: pending,
      });
    }
  }
  return prepared;
}
