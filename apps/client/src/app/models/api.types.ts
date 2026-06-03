// Client-facing shapes of the apps/server REST responses. The domain ships
// framework-free value types we reuse directly; anything carrying a `Date`
// (e.g. Assignment) is redefined here since dates arrive as ISO strings.
import type { Commitment, MishnaRef } from '@mishna/domain';

export type { Commitment, MishnaRef };

/** GET /api/me */
export interface Me {
  joined: boolean;
  commitment: Commitment | null;
}

/** GET /api/cycle */
export interface Cycle {
  cycleStart: string;
  cycleEnd: string;
  daysElapsed: number;
  daysRemaining: number;
  totalDays: number;
}

/** GET /api/assignments/today and /api/assignments?date= */
export interface Assignment {
  userId: string;
  date: string;
  mishnas: MishnaRef[];
  /** The group these mishnayot belong to; echoed back when recording completions. Null when the assignment is empty. */
  groupId: string | null;
  /** The subset of `mishnas` the caller has already marked learned. */
  completed: MishnaRef[];
}

/** GET /api/completions — every mishna the caller has marked learned. */
export interface Completions {
  completed: MishnaRef[];
}

/** One group's row in GET /api/admin/groups */
export interface AdminGroup {
  id: string;
  progress: number;
  memberCount: number;
  members: string[];
}

/** GET /api/admin/groups */
export interface AdminGroups {
  count: number;
  groups: AdminGroup[];
}
