import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { Me } from '../models/api.types';

/**
 * Session + membership state, backed by `GET /api/me`. The server validates the
 * session cookie (forwarded to the better-auth login worker), so a 200 means
 * authenticated and the body also tells us whether the user has joined a cycle.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  /** Latest /api/me result, or null while unknown/unauthenticated. */
  readonly me = signal<Me | null>(null);

  /** Fetches /api/me. Emits the Me on success, or null on 401/any failure. */
  loadSession(): Observable<Me | null> {
    return this.http.get<Me>('/api/me').pipe(
      tap((me) => this.me.set(me)),
      catchError(() => {
        this.me.set(null);
        return of(null);
      }),
    );
  }

  /** True once a session has been confirmed (regardless of join status). */
  authenticated(): Observable<boolean> {
    return this.loadSession().pipe(map((me) => me !== null));
  }

  /**
   * Kicks off better-auth's Google OAuth flow via the login worker. Requires the
   * `google` social provider to be configured in apps/login (currently a TODO),
   * after which this redirects to Google and back to `callbackURL`.
   */
  signInWithGoogle(callbackURL = '/dashboard'): void {
    this.http
      .post<{ url?: string; redirect?: boolean }>('/api/auth/sign-in/social', {
        provider: 'google',
        callbackURL,
      })
      .subscribe({
        next: (res) => {
          if (res?.url) {
            window.location.href = res.url;
          }
        },
        error: () => {
          // Surfaced to the user by the landing page's error state.
        },
      });
  }

  /** Ends the better-auth session and clears local state. */
  signOut(): Observable<unknown> {
    return this.http.post('/api/auth/sign-out', {}).pipe(
      tap(() => this.me.set(null)),
      catchError(() => {
        this.me.set(null);
        return of(null);
      }),
    );
  }
}
