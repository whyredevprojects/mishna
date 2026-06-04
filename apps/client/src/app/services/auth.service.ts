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

  /** Whether the current session belongs to an admin (from the latest /api/me). */
  isAdmin(): boolean {
    return this.me()?.isAdmin === true;
  }

  /**
   * Signs in with email + password via the login worker. On success the session
   * cookie is set; callers should refresh `loadSession()` / navigate. Emits the
   * created session on success and propagates errors (e.g. invalid credentials)
   * so the caller can surface a message.
   */
  signInWithEmail(email: string, password: string): Observable<unknown> {
    return this.http.post('/api/auth/sign-in/email', { email, password });
  }

  /**
   * Creates an account with email + password via the login worker. With no email
   * verification configured, the user is signed in immediately. Propagates errors
   * (e.g. email already registered) for the caller to display.
   */
  signUpWithEmail(
    name: string,
    email: string,
    password: string,
  ): Observable<unknown> {
    return this.http.post('/api/auth/sign-up/email', { name, email, password });
  }

  /**
   * Kicks off better-auth's Google OAuth flow via the login worker. Requires the
   * `google` social provider credentials to be configured in apps/login, after
   * which this redirects to Google and back to `callbackURL`.
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
