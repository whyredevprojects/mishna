// ---------------------------------------------------------------------------
// Email domain types
//
// The producer/consumer contract for the bulk email path, framework- and
// storage-free. `Candidate`/`Candidacy` are the inputs to the send decision;
// `PreparedEmail` is its fully-resolved output (address + the exact mishnayot to
// render), so the sender does no further per-user reads.
// ---------------------------------------------------------------------------

import { Block, EmailKind, MishnaRef } from '@mishna/domain';

export type { EmailKind } from '@mishna/domain';

/** A user's email preferences (no address, no identity). */
export interface EmailPrefs {
  timezone: string;
  weeklyEmailDow: number;
  reminderEmailDow: number;
  weeklyEnabled: boolean;
  reminderEnabled: boolean;
}

/**
 * The prefs a participant with no `user_email_prefs` row gets — the single source
 * of truth shared by the bulk path (`@mishna/email-data`), the admin readers, and
 * `GET /api/me/preferences` (all in `apps/server`). Weekly on Sunday (0), reminder
 * on Thursday (4), both enabled, New York time.
 */
export const DEFAULT_EMAIL_PREFS: EmailPrefs = {
  timezone: 'America/New_York',
  weeklyEmailDow: 0,
  reminderEmailDow: 4,
  weeklyEnabled: true,
  reminderEnabled: true,
};

/**
 * A participant + their email preferences, *without* the email address. The bulk
 * path resolves who is due from these (the timezone math needs every prefs row),
 * then fetches addresses only for the due subset.
 */
export type Candidate = EmailPrefs & { userId: string };

/** A (user, kind, week) tuple due at the send hour, before dedup/resolution. */
export interface Candidacy {
  userId: string;
  kind: EmailKind;
  /** YYYY-MM-DD, user-local: the anchor (start) of the target week. */
  weekStart: string;
}

/** One fully-resolved send: address + the exact mishnayot already in hand. */
export interface PreparedEmail {
  userId: string;
  kind: EmailKind;
  /** YYYY-MM-DD, user-local. */
  weekStart: string;
  /** Recipient email address. */
  to: string;
  /** The exact mishnayot to render. */
  refs: MishnaRef[];
  /**
   * The positional bucket index `refs` were sliced from, pinned here at plan time.
   *
   * The email's "I've memorized this" link carries this index and re-derives the refs
   * from it on click. It must be captured with the job and never recomputed later:
   * `nextUnlearnedBucket` advances the moment a bucket is complete, so a user who
   * checked this bucket off in the app first would otherwise have the link mark the
   * *next* bucket — one they never saw. Pinning it also keeps the rendered body a pure
   * function of the job, which is what the Resend idempotency key requires (see
   * `memorized-token.ts`).
   */
  bucket: number;
}

/** The batched per-user inputs `buildPreparedEmails` resolves the content from. */
export interface ResolvedData {
  blocksByUser: Map<string, Block[]>;
  completedByUser: Map<string, MishnaRef[]>;
  emailByUser: Map<string, string>;
}

/**
 * The slice of `AssignmentEngine` the email path needs: the user's next
 * still-unlearned bucket, and that bucket's index. `@mishna/domain`'s `AssignmentEngine` satisfies this
 * structurally, so the domain stays decoupled from the concrete engine.
 */
export interface AssignmentSource {
  getNextAssignment(
    blocks: Block[],
    completed: MishnaRef[],
    date: Date,
  ): { mishnas: MishnaRef[] };
  /**
   * The index of that same bucket, pinned onto `PreparedEmail.bucket`. The engine
   * defines `getNextAssignment` as `getBucketAssignment(nextUnlearnedBucket(...))`,
   * so the two always agree — `plan-sends.spec.ts` pins that identity, because it is
   * what makes "store the index, re-derive the refs later" safe.
   */
  nextUnlearnedBucket(
    blocks: Block[],
    completed: MishnaRef[],
    date: Date,
  ): number;
}
