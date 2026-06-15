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
  /**
   * Group id for each assigned mishna, parallel to `assigned` (the group for
   * `assigned[i]` is `groupIds[i]`) — the id a completion is recorded under.
   * Per-ref because a user's lots can spill across groups at an overflow boundary.
   */
  groupIds: string[];
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
  /** Whether the email is verified (Google sign-ins are; password sign-ups aren't). */
  emailVerified: boolean;
  /** ISO timestamp of account creation, or null if the directory omits it. */
  createdAt: string | null;
  joined: boolean;
  commitment: Commitment | null;
}

/** Paging params shared by the admin list endpoints (`limit` is capped at 50). */
export interface PageParams {
  limit: number;
  offset: number;
  /** Free-text match (email, or name when it has no `@`). */
  search?: string;
  /** `field:asc|desc`, e.g. `createdAt:desc`. */
  sort?: string;
}

/** GET /api/admin/users — one page plus the total for the paginator. */
export interface AdminUsers {
  users: AdminUser[];
  total: number;
  limit: number;
  offset: number;
}

/** GET /api/admin/users/:id */
export interface AdminUserDetail extends AdminUser {
  groups: { id: string; blockSize: number }[];
}

/** GET /api/admin/stats — the Overview dashboard counters. */
export interface AdminStats {
  activeUsers: number;
  verifiedUsers: number;
  totalGroups: number;
  totalCompletions: number;
  weekCompletions: number;
  weekStart: string;
}

/** One member row in GET /api/admin/groups/:id */
export interface AdminGroupMember {
  id: string;
  name: string | null;
  email: string | null;
  emailVerified: boolean;
  blockSize: number;
  /** The lot numbers (1..120) this member holds in this group, ascending. */
  lots: number[];
}

/**
 * One of the 120 pre-set lots, as carried on GET /api/admin/lots. `label` is
 * `mesechta:indexInMesechta` (e.g. `Peah:1`); `start`/`end` bound its range.
 */
export interface AdminLot {
  lot: number;
  mesechta: string;
  indexInMesechta: number;
  label: string;
  start: MishnaRef;
  end: MishnaRef;
  size: number;
}

/** GET /api/admin/groups/:id */
export interface AdminGroupDetail {
  id: string;
  progress: number;
  memberCount: number;
  members: AdminGroupMember[];
}

/** One of a user's mishnayot for the week, in GET /api/admin/assignments. */
export interface AdminAssignmentMishna extends MishnaRef {
  /** The group this mishna belongs to; null if unresolved (action disabled). */
  groupId: string | null;
  done: boolean;
}

/** One participant's row in GET /api/admin/assignments. */
export interface AdminAssignmentRow {
  userId: string;
  name: string | null;
  email: string | null;
  emailVerified: boolean;
  /** Whether the weekly email for this week has gone out. */
  emailSent: boolean;
  mishnas: AdminAssignmentMishna[];
}

/** GET /api/admin/assignments — one page for the selected week. */
export interface AdminAssignmentsPage {
  weekStart: string;
  rows: AdminAssignmentRow[];
  total: number;
}
