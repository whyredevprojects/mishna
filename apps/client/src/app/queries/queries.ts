/**
 * Query-options factories: the bridge between the thin per-area services (which own
 * the URLs) and TanStack Query (which owns caching/dedup). Each factory wraps a
 * service observable as a `queryFn` via `firstValueFrom`, so the HTTP calls live in
 * exactly one place. Pass the already-injected service in from the caller's injection
 * context.
 */
import { queryOptions } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';
import { queryKeys } from './query-keys';
import { AuthService } from '../services/auth.service';
import { CycleService } from '../services/cycle.service';
import { AssignmentService } from '../services/assignment.service';
import { AdminService } from '../services/admin.service';

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

/** GET /api/admin/groups. Live monitoring view — short freshness. */
export function adminGroupsQueryOptions(admin: AdminService) {
  return queryOptions({
    queryKey: queryKeys.adminGroups,
    queryFn: () => firstValueFrom(admin.groups()),
    staleTime: 0,
  });
}

/** GET /api/admin/users. */
export function adminUsersQueryOptions(admin: AdminService) {
  return queryOptions({
    queryKey: queryKeys.adminUsers,
    queryFn: () => firstValueFrom(admin.users()),
    staleTime: 0,
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
