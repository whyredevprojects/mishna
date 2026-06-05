/**
 * Query-options factories: the bridge between the thin per-area services (which own
 * the URLs) and TanStack Query (which owns caching/dedup). Each factory wraps a
 * service observable as a `queryFn` via `firstValueFrom`, so the HTTP calls live in
 * exactly one place. Pass the already-injected service in from the caller's injection
 * context.
 */
import {
  keepPreviousData,
  queryOptions,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';
import { queryKeys } from './query-keys';
import { AuthService } from '../services/auth.service';
import { CycleService } from '../services/cycle.service';
import { AssignmentService } from '../services/assignment.service';
import { AdminService } from '../services/admin.service';
import { PageParams } from '../models/api.types';

const MINUTE = 60_000;

/** GET /api/me. Shared by both guards and the dashboard, so they dedup to one fetch. */
export function meQueryOptions(auth: AuthService) {
  return queryOptions({
    queryKey: queryKeys.me,
    queryFn: () => firstValueFrom(auth.loadSession()),
    staleTime: MINUTE,
  });
}

/** GET /api/cycle. Changes at most once a day, so keep it fresh for a long while. */
export function cycleQueryOptions(cycle: CycleService) {
  return queryOptions({
    queryKey: queryKeys.cycle,
    queryFn: () => firstValueFrom(cycle.getCycle()),
    staleTime: 60 * MINUTE,
  });
}

/** GET /api/assignments/today. */
export function todayAssignmentQueryOptions(assignments: AssignmentService) {
  return queryOptions({
    queryKey: queryKeys.assignmentToday,
    queryFn: () => firstValueFrom(assignments.today()),
  });
}

/** GET /api/me/chaluka — the caller's whole-cycle portion + learned subset. */
export function chalukaQueryOptions(assignments: AssignmentService) {
  return queryOptions({
    queryKey: queryKeys.chaluka,
    queryFn: () => firstValueFrom(assignments.chaluka()),
  });
}

/** GET /api/assignments?date= — one cache entry per date. */
export function assignmentByDateQueryOptions(
  assignments: AssignmentService,
  date: string,
) {
  return queryOptions({
    queryKey: queryKeys.assignment(date),
    queryFn: () => firstValueFrom(assignments.forDate(date)),
  });
}

/** GET /api/admin/stats. Live dashboard — short freshness. */
export function adminStatsQueryOptions(admin: AdminService) {
  return queryOptions({
    queryKey: queryKeys.adminStats,
    queryFn: () => firstValueFrom(admin.stats()),
    staleTime: 0,
  });
}

/** GET /api/admin/groups. Live monitoring view — short freshness. */
export function adminGroupsQueryOptions(admin: AdminService) {
  return queryOptions({
    queryKey: queryKeys.adminGroups,
    queryFn: () => firstValueFrom(admin.groups()),
    staleTime: 0,
  });
}

/** GET /api/admin/groups/:id. */
export function adminGroupQueryOptions(admin: AdminService, id: string) {
  return queryOptions({
    queryKey: queryKeys.adminGroup(id),
    queryFn: () => firstValueFrom(admin.group(id)),
    staleTime: 0,
  });
}

/** GET /api/admin/users — one page. `keepPreviousData` so paging doesn't flash. */
export function adminUsersQueryOptions(admin: AdminService, params: PageParams) {
  return queryOptions({
    queryKey: queryKeys.adminUsersPage({ ...params }),
    queryFn: () => firstValueFrom(admin.users(params)),
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
}

/** GET /api/admin/users/:id. */
export function adminUserQueryOptions(admin: AdminService, id: string) {
  return queryOptions({
    queryKey: queryKeys.adminUser(id),
    queryFn: () => firstValueFrom(admin.user(id)),
    staleTime: 0,
  });
}

/** GET /api/admin/assignments — one week/page. */
export function adminAssignmentsQueryOptions(
  admin: AdminService,
  params: PageParams & { week?: string },
) {
  return queryOptions({
    queryKey: queryKeys.adminAssignmentsPage({ ...params }),
    queryFn: () => firstValueFrom(admin.assignments(params)),
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
}
