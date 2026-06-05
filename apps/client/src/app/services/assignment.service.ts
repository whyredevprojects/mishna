import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Assignment, Chaluka, MishnaRef } from '../models/api.types';

/** Reads the caller's weekly mishnayot and completion state from apps/server. */
@Injectable({ providedIn: 'root' })
export class AssignmentService {
  private readonly http = inject(HttpClient);

  /** This week's assignment for the caller. */
  today(): Observable<Assignment> {
    return this.http.get<Assignment>('/api/assignments/today');
  }

  /** The caller's assignment for an explicit `YYYY-MM-DD` (interpreted UTC). */
  forDate(date: string): Observable<Assignment> {
    return this.http.get<Assignment>('/api/assignments', {
      params: new HttpParams().set('date', date),
    });
  }

  /** The caller's whole-cycle portion: every assigned mishna + the learned subset. */
  chaluka(): Observable<Chaluka> {
    return this.http.get<Chaluka>('/api/me/chaluka');
  }

  /** Mark a mishna learned. `groupId` comes from the assignment it belongs to. */
  markLearned(ref: MishnaRef, groupId: string): Observable<unknown> {
    return this.http.post('/api/completions', { ref, groupId });
  }

  /** Unmark a mishna previously marked learned. */
  markUnlearned(ref: MishnaRef, groupId: string): Observable<unknown> {
    return this.http.request('DELETE', '/api/completions', {
      body: { ref, groupId },
    });
  }
}
