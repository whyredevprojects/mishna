// ---------------------------------------------------------------------------
// EmailRepository — the data port the email domain declares but does not ship.
//
// Mirrors @mishna/domain's GroupRepository seam: the production adapter
// (D1EmailRepository in @mishna/email-data) talks to D1; tests and local use the
// in-memory impl here. Reads are batched by design — the consumer hands a set of
// user ids and gets back a map, so a run stays O(due/100) subrequests, not O(due).
// ---------------------------------------------------------------------------

import { Block, EmailKind, MishnaRef } from '@mishna/domain';
import { Candidate } from './types';
import { sentKey } from './plan-sends';

export interface EmailRepository {
  /** Every joined participant + their email prefs (defaults where no row), no addresses. */
  loadCandidates(): Promise<Candidate[]>;
  /**
   * The set of `${userId}|${kind}|${weekStart}` already sent, for the given users,
   * bounded to `sinceWeekStart` onward so each user matches at most this week's rows.
   */
  alreadySent(userIds: string[], sinceWeekStart: string): Promise<Set<string>>;
  /** Blocks per user across their groups. */
  loadBlocks(userIds: string[]): Promise<Map<string, Block[]>>;
  /** Completed refs per user (distinct). */
  loadCompleted(userIds: string[]): Promise<Map<string, MishnaRef[]>>;
  /** Verified addresses for the given users, as `userId → email` (others omitted). */
  loadEmails(userIds: string[]): Promise<Map<string, string>>;
  /** Record a successful send (idempotent on the (user, kind, week) key). */
  recordSent(userId: string, kind: EmailKind, weekStart: string): Promise<void>;
}

/** The fixed snapshot an {@link InMemoryEmailRepository} serves. */
export interface InMemoryEmailData {
  candidates: Candidate[];
  blocks?: Map<string, Block[]>;
  completed?: Map<string, MishnaRef[]>;
  emails?: Map<string, string>;
  /** Pre-existing `${userId}|${kind}|${weekStart}` sends (the dedup log). */
  sent?: Iterable<string>;
}

/**
 * An in-memory {@link EmailRepository} over a fixed snapshot — the email path's
 * analogue of `InMemoryGroupRepository`. `recordSent` mutates an internal set, so
 * a test can send then assert the (user, kind, week) was logged.
 */
export class InMemoryEmailRepository implements EmailRepository {
  private readonly candidates: Candidate[];
  private readonly blocks: Map<string, Block[]>;
  private readonly completed: Map<string, MishnaRef[]>;
  private readonly emails: Map<string, string>;
  private readonly sentLog: Set<string>;

  constructor(data: InMemoryEmailData) {
    this.candidates = data.candidates;
    this.blocks = data.blocks ?? new Map();
    this.completed = data.completed ?? new Map();
    this.emails = data.emails ?? new Map();
    this.sentLog = new Set(data.sent ?? []);
  }

  async loadCandidates(): Promise<Candidate[]> {
    return this.candidates;
  }

  async alreadySent(
    userIds: string[],
    sinceWeekStart: string,
  ): Promise<Set<string>> {
    const ids = new Set(userIds);
    const out = new Set<string>();
    for (const key of this.sentLog) {
      const [userId, , weekStart] = key.split('|');
      if (ids.has(userId) && weekStart >= sinceWeekStart) out.add(key);
    }
    return out;
  }

  async loadBlocks(userIds: string[]): Promise<Map<string, Block[]>> {
    return pick(this.blocks, userIds);
  }

  async loadCompleted(userIds: string[]): Promise<Map<string, MishnaRef[]>> {
    return pick(this.completed, userIds);
  }

  async loadEmails(userIds: string[]): Promise<Map<string, string>> {
    return pick(this.emails, userIds);
  }

  async recordSent(
    userId: string,
    kind: EmailKind,
    weekStart: string,
  ): Promise<void> {
    this.sentLog.add(sentKey(userId, kind, weekStart));
  }

  /** The (user, kind, week) sends recorded so far, for assertions. */
  get recorded(): ReadonlySet<string> {
    return this.sentLog;
  }
}

/** The subset of `source` keyed by `userIds` (missing keys simply absent). */
function pick<V>(source: Map<string, V>, userIds: string[]): Map<string, V> {
  const out = new Map<string, V>();
  for (const id of userIds) {
    const v = source.get(id);
    if (v !== undefined) out.set(id, v);
  }
  return out;
}
