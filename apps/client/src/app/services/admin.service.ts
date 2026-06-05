import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  AdminAssignmentsPage,
  AdminGroupDetail,
  AdminGroups,
  AdminStats,
  AdminUserDetail,
  AdminUsers,
  MishnaRef,
  PageParams,
} from '../models/api.types';

/** A `{ ref, groupId }` completion target for the admin learn/unlearn actions. */
export interface CompletionTarget {
  ref: MishnaRef;
  groupId: string;
}

/** Admin data + user management. All endpoints are gated by `requireAdmin`. */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);

  /** Overview dashboard counters. */
  stats(): Observable<AdminStats> {
    return this.http.get<AdminStats>('/api/admin/stats');
  }

  groups(): Observable<AdminGroups> {
    return this.http.get<AdminGroups>('/api/admin/groups');
  }

  /** One group with its members resolved to identity + block size. */
  group(id: string): Observable<AdminGroupDetail> {
    return this.http.get<AdminGroupDetail>(`/api/admin/groups/${id}`);
  }

  /** One page of users (server-side paging/search/sort). */
  users(params: PageParams): Observable<AdminUsers> {
    return this.http.get<AdminUsers>('/api/admin/users', {
      params: this.pageParams(params),
    });
  }

  user(id: string): Observable<AdminUserDetail> {
    return this.http.get<AdminUserDetail>(`/api/admin/users/${id}`);
  }

  /** One page of the selected week's per-user assignments. */
  assignments(
    params: PageParams & { week?: string },
  ): Observable<AdminAssignmentsPage> {
    let p = this.pageParams(params);
    if (params.week) p = p.set('week', params.week);
    return this.http.get<AdminAssignmentsPage>('/api/admin/assignments', {
      params: p,
    });
  }

  /** Frees a user's mishnayot back to their groups, leaving the account intact. */
  removeAssignments(id: string): Observable<unknown> {
    return this.http.post(`/api/admin/users/${id}/remove-assignments`, {});
  }

  /** Hard-deletes a user (cascades assignment cleanup server-side). */
  deleteUser(id: string): Observable<unknown> {
    return this.http.delete(`/api/admin/users/${id}`);
  }

  /** Promotes the user to admin (`'admin'`) or revokes it (`'user'`). */
  setRole(id: string, role: 'admin' | 'user'): Observable<unknown> {
    return this.http.post(`/api/admin/users/${id}/set-role`, { role });
  }

  /** Queues an extra weekly mishnayos email for the user (bypasses dedup). */
  sendWeekly(id: string): Observable<unknown> {
    return this.http.post(`/api/admin/users/${id}/send-weekly`, {});
  }

  /** Queues an extra reminder email for the user (bypasses dedup). */
  sendReminder(id: string): Observable<unknown> {
    return this.http.post(`/api/admin/users/${id}/send-reminder`, {});
  }

  /** Re-sends the better-auth verification email to a pending user. */
  sendVerification(id: string): Observable<unknown> {
    return this.http.post(`/api/admin/users/${id}/send-verification`, {});
  }

  /** Marks a mishna learned on the user's behalf. */
  markLearned(id: string, target: CompletionTarget): Observable<unknown> {
    return this.http.post(`/api/admin/users/${id}/completions`, target);
  }

  /** Unmarks a mishna on the user's behalf. */
  unlearn(id: string, target: CompletionTarget): Observable<unknown> {
    return this.http.delete(`/api/admin/users/${id}/completions`, {
      body: target,
    });
  }

  private pageParams(params: PageParams): HttpParams {
    let p = new HttpParams()
      .set('limit', String(params.limit))
      .set('offset', String(params.offset));
    if (params.search) p = p.set('search', params.search);
    if (params.sort) p = p.set('sort', params.sort);
    return p;
  }
}
