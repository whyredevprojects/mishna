import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Commitment, JoinOptions } from '../models/api.types';

/** Join / leave the current cycle. Allocation is serialized server-side. */
@Injectable({ providedIn: 'root' })
export class GroupService {
  private readonly http = inject(HttpClient);

  /** The signup commitment choices as of today (lot estimates per pace). */
  joinOptions(): Observable<JoinOptions> {
    return this.http.get<JoinOptions>('/api/join-options');
  }

  /** Join with a per-week commitment of 1, 2, or 3 mishnayot. */
  join(commitment: Commitment): Observable<unknown> {
    return this.http.post('/api/join', { commitment });
  }

  /** Leave the cycle, returning the user's ranges to their groups. */
  leave(): Observable<unknown> {
    return this.http.post('/api/leave', {});
  }
}
