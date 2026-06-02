import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Cycle } from '../models/api.types';

/** Reads the public `GET /api/cycle` (current cycle bounds + progress). */
@Injectable({ providedIn: 'root' })
export class CycleService {
  private readonly http = inject(HttpClient);

  getCycle(): Observable<Cycle> {
    return this.http.get<Cycle>('/api/cycle');
  }
}
