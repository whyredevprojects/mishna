// ---------------------------------------------------------------------------
// The bulk email send decision — who gets which email, when, with what content.
//
// Pure with respect to the clock (`now` is passed in) and to storage (data comes
// from an injected EmailRepository, content from an injected AssignmentSource).
// Split into small, independently-testable steps:
//   selectDue        — who is at 08:00 local *now*, and which (kind, week)?
//   dropAlreadySent  — drop the ones already sent this week (the dedup pass)
//   buildPreparedEmails — resolve survivors to fully-rendered sends
//   planSends        — orchestrate the three over the repository (batched reads)
// ---------------------------------------------------------------------------

import {
  EmailKind,
  MishnaRef,
  localParts,
  weekStartOnOrBefore,
} from '@mishna/domain';
import { prepareSingle } from './content';
import { EmailRepository } from './email-repository';
import {
  AssignmentSource,
  Candidacy,
  Candidate,
  PreparedEmail,
  ResolvedData,
} from './types';

// Emails go out at 08:00 in the recipient's own timezone. The cron fires hourly,
// so this matches each zone exactly once per local day.
export const SEND_HOUR = 8;

/** `mesechta|perek|mishna` identity, matching the server's completions key. */
export function refKey(ref: MishnaRef): string {
  return `${ref.mesechta}|${ref.perek}|${ref.mishna}`;
}

/**
 * The mishnayot a given email kind should show from the user's next unlearned
 * bucket: weekly shows the whole bucket; reminder shows only its still-pending
 * mishnayot. The single source of this rule — used by the bulk path
 * (`buildPreparedEmails`) and admin "send now" (`prepareOne`).
 */
export function refsForKind(
  kind: EmailKind,
  next: MishnaRef[],
  completed: MishnaRef[],
): MishnaRef[] {
  if (kind === 'weekly') return next;
  const done = new Set(completed.map(refKey));
  return next.filter((r) => !done.has(refKey(r)));
}

/** The `${userId}|${kind}|${weekStart}` dedup key for one (user, kind, week). */
export function sentKey(
  userId: string,
  kind: EmailKind,
  weekStart: string,
): string {
  return `${userId}|${kind}|${weekStart}`;
}

/**
 * The candidacies due *right now*: only users for whom it is currently 08:00
 * local, weekly on their weekly weekday and reminder on their reminder weekday
 * (when enabled). Both kinds anchor their week to the user's weekly-email weekday.
 */
export function selectDue(candidates: Candidate[], now: Date): Candidacy[] {
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
  return due;
}

/** Drop candidacies whose (user, kind, week) is already in `sentSet`. */
export function dropAlreadySent(
  due: Candidacy[],
  sentSet: Set<string>,
): Candidacy[] {
  return due.filter((d) => !sentSet.has(sentKey(d.userId, d.kind, d.weekStart)));
}

/** The earliest week anchor across the candidacies (the dedup read's lower bound). */
function earliestWeek(due: Candidacy[]): string {
  return due.reduce(
    (min, d) => (d.weekStart < min ? d.weekStart : min),
    due[0].weekStart,
  );
}

/**
 * Resolve live candidacies to fully-rendered sends. The content is the user's
 * next still-unlearned bucket (same as the dashboard): weekly shows the whole
 * bucket, reminder only its still-pending mishnayot. Skips users with no address,
 * and anyone who has learned their whole portion (an empty bucket — nothing left).
 *
 * The per-user decision is `prepareSingle` (`content.ts`) — the *same* function admin
 * send-now uses, with `skipWhenEmpty` as the one deliberate difference between the
 * two callers, so the content rule can't drift between the schedule and the button.
 */
export function buildPreparedEmails(
  live: Candidacy[],
  data: ResolvedData,
  engine: AssignmentSource,
  now: Date,
): PreparedEmail[] {
  const prepared: PreparedEmail[] = [];
  for (const d of live) {
    const one = prepareSingle(
      {
        userId: d.userId,
        kind: d.kind,
        weekStart: d.weekStart,
        to: data.emailByUser.get(d.userId),
        blocks: data.blocksByUser.get(d.userId) ?? [],
        completed: data.completedByUser.get(d.userId) ?? [],
        date: now,
      },
      engine,
      // The bulk path stops mailing a user who has finished their whole portion.
      { skipWhenEmpty: true },
    );
    if (one) prepared.push(one);
  }
  return prepared;
}

/**
 * Decide which emails to send at `now`, fully resolved (address + the mishnayot
 * to render) so the sender does no per-user DB reads. All reads are batched: the
 * naive per-user N+1 (dedup, blocks, completions, emails) collapses into a handful
 * of set-based reads on the repository, so a run stays well inside the
 * per-invocation subrequest budget no matter how many users are due in one hour.
 */
export async function planSends(
  repo: EmailRepository,
  engine: AssignmentSource,
  now: Date,
): Promise<PreparedEmail[]> {
  // 1. Who is at 08:00 local, and which (kind, week) do they qualify for?
  const due = selectDue(await repo.loadCandidates(), now);
  if (due.length === 0) return [];

  // 2. Drop ones already sent this week (one batched dedup read).
  const dueUserIds = [...new Set(due.map((d) => d.userId))];
  const sent = await repo.alreadySent(dueUserIds, earliestWeek(due));
  const live = dropAlreadySent(due, sent);
  if (live.length === 0) return [];

  // 3. Resolve blocks + completions + addresses for the survivors (batched).
  //    Completions are needed for every live user (weekly *and* reminder), since
  //    the content is the next still-unlearned bucket, not a fixed calendar slice.
  const liveUserIds = [...new Set(live.map((d) => d.userId))];
  const [blocksByUser, completedByUser, emailByUser] = await Promise.all([
    repo.loadBlocks(liveUserIds),
    repo.loadCompleted(liveUserIds),
    repo.loadEmails(liveUserIds),
  ]);

  // 4. Build the prepared sends.
  return buildPreparedEmails(
    live,
    { blocksByUser, completedByUser, emailByUser },
    engine,
    now,
  );
}
