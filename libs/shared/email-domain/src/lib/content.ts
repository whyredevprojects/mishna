// ---------------------------------------------------------------------------
// What goes *in* one email: the mishnayot to show, and the Hebrew text port that
// resolves them.
//
// `prepareSingle` is the single decision "does this user get this email, and with
// what content" — used by both callers, with the one difference between them
// expressed as a parameter rather than as a second code path:
//
//   bulk (`buildPreparedEmails`)   skipWhenEmpty: true   — a finished user gets no mail
//   admin send-now (`prepareOne`)  skipWhenEmpty: false  — the admin asked; send the
//                                                          empty-state email anyway
//
// Pure: no clock (the date is passed), no storage (blocks/completions are passed),
// no engine singleton (the `AssignmentSource` is injected).
// ---------------------------------------------------------------------------

import { Block, EmailKind, MishnaRef } from '@mishna/domain';
import { refsForKind } from './plan-sends';
import { AssignmentSource, PreparedEmail } from './types';

/** One mishna, resolved to the Hebrew text a template renders. */
export interface ResolvedMishna {
  ref: MishnaRef;
  tractateHebrew: string;
  hebrew: string;
}

/**
 * A function that yields the Hebrew text for a set of refs. Injectable so the
 * consumer can be tested without the network; `apps/server`'s `httpTextResolver` is
 * the production implementation.
 */
export type TextResolver = (refs: MishnaRef[]) => Promise<ResolvedMishna[]>;

/**
 * The mishnayot one email should carry: the user's next still-unlearned bucket,
 * narrowed by the kind's rule (`refsForKind`).
 *
 * `date` only stamps the result; it never selects the bucket (the bucket is chosen by
 * progress, not by the calendar), so the email's send date is fine to pass. The
 * engine is a parameter, so nothing here reaches for a module singleton.
 */
export function resolveOne(
  kind: EmailKind,
  blocks: Block[],
  completed: MishnaRef[],
  date: Date,
  engine: AssignmentSource,
): MishnaRef[] {
  const next = engine.getNextAssignment(blocks, completed, date).mishnas;
  return refsForKind(kind, next, completed);
}

/** Everything one send needs, already loaded by the caller. */
export interface SingleSendInput {
  userId: string;
  kind: EmailKind;
  /** YYYY-MM-DD, user-local: the anchor of the target week. */
  weekStart: string;
  /** The recipient's verified address, or null/undefined if they have none. */
  to: string | null | undefined;
  blocks: Block[];
  completed: MishnaRef[];
  /** The instant the send is stamped with (never selects the bucket). */
  date: Date;
}

export interface PrepareOptions {
  /**
   * Skip the send entirely when there is nothing left to show (the user has learned
   * their whole portion, so the next bucket is empty).
   *
   * `true` for the **bulk** path: a finished user must stop receiving scheduled mail.
   * `false` for **admin send-now**: an admin who presses "Send weekly" on a finished
   * user asked for an email, and silently sending nothing looks like a broken button.
   * They get the templates' empty state ("You have no mishnayos scheduled…"), which
   * is a real, deliberate email. The admin UI shows the counts next to the buttons so
   * this is never a surprise.
   */
  skipWhenEmpty: boolean;
}

/**
 * Resolve one user's send, or `null` if they can't/shouldn't be emailed.
 *
 * Two reasons to return null: no address (never mail one we don't have — the bulk
 * reader already filters unverified), and, when `skipWhenEmpty`, an empty portion.
 *
 * Note the empty test is on the *resolved refs*, which for a weekly is exactly the
 * next bucket. A reminder's refs can only be empty when its bucket is (the engine
 * picks the first bucket holding an unlearned mishna), so the two readings coincide
 * — the refs are the more direct statement of "this email would have nothing in it".
 */
export function prepareSingle(
  input: SingleSendInput,
  engine: AssignmentSource,
  opts: PrepareOptions,
): PreparedEmail | null {
  const { userId, kind, weekStart, to, blocks, completed, date } = input;
  if (!to) return null;
  const refs = resolveOne(kind, blocks, completed, date, engine);
  if (opts.skipWhenEmpty && refs.length === 0) return null;
  // Pin the bucket the refs came from. `resolveOne` goes through `getNextAssignment`,
  // which the engine defines as `getBucketAssignment(nextUnlearnedBucket(...))`, so
  // this index and those refs describe the same slice by construction.
  const bucket = engine.nextUnlearnedBucket(blocks, completed, date);
  return { userId, kind, weekStart, to, refs, bucket };
}
