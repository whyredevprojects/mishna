import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { EmailPrefs } from '../models/api.types';

/** The signed-in user's email preferences (timezone + reminder schedule). */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);

  getPreferences(): Observable<EmailPrefs> {
    return this.http.get<EmailPrefs>('/api/me/preferences');
  }

  updatePreferences(prefs: EmailPrefs): Observable<EmailPrefs> {
    return this.http.put<EmailPrefs>('/api/me/preferences', prefs);
  }
}
