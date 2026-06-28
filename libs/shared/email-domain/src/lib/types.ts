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

/**
 * A participant + their email preferences, *without* the email address. The bulk
 * path resolves who is due from these (the timezone math needs every prefs row),
 * then fetches addresses only for the due subset.
 */
export interface Candidate {
  userId: string;
  timezone: string;
  weeklyEmailDow: number;
  reminderEmailDow: number;
  weeklyEnabled: boolean;
  reminderEnabled: boolean;
}

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
}

/** The batched per-user inputs `buildPreparedEmails` resolves the content from. */
export interface ResolvedData {
  blocksByUser: Map<string, Block[]>;
  completedByUser: Map<string, MishnaRef[]>;
  emailByUser: Map<string, string>;
}

/**
 * The slice of `AssignmentEngine` the email path needs: the user's next
 * still-unlearned bucket. `@mishna/domain`'s `AssignmentEngine` satisfies this
 * structurally, so the domain stays decoupled from the concrete engine.
 */
export interface AssignmentSource {
  getNextAssignment(
    blocks: Block[],
    completed: MishnaRef[],
    date: Date,
  ): { mishnas: MishnaRef[] };
}
