// Client-facing shapes of the apps/server REST responses. The domain ships
// framework-free value types we reuse directly; anything carrying a `Date`
// (e.g. Assignment) is redefined here since dates arrive as ISO strings.
import type { Commitment, MishnaRef } from '@mishna/domain';

export type { Commitment, MishnaRef };

/** The signed-in user's identity, as carried on GET /api/me. */
export interface UserInfo {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
}

/** GET /api/me */
export interface Me {
  joined: boolean;
  commitment: Commitment | null;
  user: UserInfo;
  isAdmin: boolean;
}

/** Day of week, 0=Sunday … 6=Saturday (matches the server + JS getUTCDay). */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** GET/PUT /api/me/preferences — the user's email settings. */
export interface EmailPrefs {
  /** IANA timezone; emails fire at 08:00 in this zone. */
  timezone: string;
  weeklyEmailDow: DayOfWeek;
  reminderEmailDow: DayOfWeek;
  weeklyEnabled: boolean;
  reminderEnabled: boolean;
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

/**
 * GET /api/me/chaluka — the caller's whole-cycle portion. `assigned` is every
 * mishna in their blocks (corpus order); `completed` is the learned subset.
 */
export interface Chaluka {
  commitment: Commitment | null;
  joinedAt: string | null;
  assigned: MishnaRef[];
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

/** One user's row in GET /api/admin/users */
export interface AdminUser {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  joined: boolean;
  commitment: Commitment | null;
}

/** GET /api/admin/users */
export interface AdminUsers {
  users: AdminUser[];
  total: number;
}

/** GET /api/admin/users/:id */
export interface AdminUserDetail extends AdminUser {
  groups: { id: string; blockSize: number }[];
}
