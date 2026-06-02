import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AdminGroups } from '../models/api.types';

/** Reads per-group progress and membership for the admin view. */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);

  groups(): Observable<AdminGroups> {
    return this.http.get<AdminGroups>('/api/admin/groups');
  }
}
