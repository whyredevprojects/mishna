import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Assignment } from '../models/api.types';

/** Reads the caller's daily mishnayot from apps/server. */
@Injectable({ providedIn: 'root' })
export class AssignmentService {
  private readonly http = inject(HttpClient);

  /** Today's assignment for the caller. */
  today(): Observable<Assignment> {
    return this.http.get<Assignment>('/api/assignments/today');
  }

  /** The caller's assignment for an explicit `YYYY-MM-DD` (interpreted UTC). */
  forDate(date: string): Observable<Assignment> {
    return this.http.get<Assignment>('/api/assignments', {
      params: new HttpParams().set('date', date),
    });
  }
}
