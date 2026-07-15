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
import { AboutLocale, AdminService } from '../services/admin.service';
import { GroupService } from '../services/group.service';
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

/** GET /api/join-options. Shifts slowly (lot estimates change by the day). */
export function joinOptionsQueryOptions(groups: GroupService) {
  return queryOptions({
    queryKey: queryKeys.joinOptions,
    queryFn: () => firstValueFrom(groups.joinOptions()),
    staleTime: 60 * MINUTE,
  });
}

/** GET /api/me/chaluka — the caller's whole-cycle portion + learned subset. */
export function chalukaQueryOptions(assignments: AssignmentService) {
  return queryOptions({
    queryKey: queryKeys.chaluka,
    queryFn: () => firstValueFrom(assignments.chaluka()),
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

/** GET /api/admin/lots — the lot catalog is static, so keep it fresh for a long while. */
export function adminLotsQueryOptions(admin: AdminService) {
  return queryOptions({
    queryKey: queryKeys.adminLots,
    queryFn: () => firstValueFrom(admin.lots()),
    staleTime: 60 * MINUTE,
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

/** GET /api/admin/about?locale= — the www site's editable Markdown for a locale. Always
 * refetch (live edit); keyed per locale so each caches independently. */
export function adminAboutQueryOptions(admin: AdminService, locale: AboutLocale) {
  return queryOptions({
    queryKey: queryKeys.adminAbout(locale),
    queryFn: () => firstValueFrom(admin.getAbout(locale)),
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
