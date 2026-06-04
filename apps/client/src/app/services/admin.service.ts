import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AdminGroups, AdminUserDetail, AdminUsers } from '../models/api.types';

/** Admin data + user management. All endpoints are gated by `requireAdmin`. */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);

  groups(): Observable<AdminGroups> {
    return this.http.get<AdminGroups>('/api/admin/groups');
  }

  users(): Observable<AdminUsers> {
    return this.http.get<AdminUsers>('/api/admin/users');
  }

  user(id: string): Observable<AdminUserDetail> {
    return this.http.get<AdminUserDetail>(`/api/admin/users/${id}`);
  }

  /** Frees a user's mishnayot back to their groups, leaving the account intact. */
  removeAssignments(id: string): Observable<unknown> {
    return this.http.post(`/api/admin/users/${id}/remove-assignments`, {});
  }

  /** Hard-deletes a user (cascades assignment cleanup server-side). */
  deleteUser(id: string): Observable<unknown> {
    return this.http.delete(`/api/admin/users/${id}`);
  }
}
