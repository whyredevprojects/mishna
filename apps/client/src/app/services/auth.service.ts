import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Me } from '../models/api.types';

/**
 * Session + membership state, backed by `GET /api/me`. The server validates the
 * session cookie (forwarded to the better-auth login worker), so a 200 means
 * authenticated and the body also tells us whether the user has joined a cycle.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly queryClient = inject(QueryClient);

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
   * so the caller can surface a message. `captchaToken` is the Cloudflare
   * Turnstile token, which the login worker's captcha plugin requires.
   */
  signInWithEmail(
    email: string,
    password: string,
    captchaToken?: string,
  ): Observable<unknown> {
    return this.http.post(
      '/api/auth/sign-in/email',
      { email, password },
      captchaOptions(captchaToken),
    );
  }

  /**
   * Creates an account with email + password via the login worker. With no email
   * verification configured, the user is signed in immediately. Propagates errors
   * (e.g. email already registered) for the caller to display. `captchaToken` is
   * the Cloudflare Turnstile token required by the login worker's captcha plugin.
   */
  signUpWithEmail(
    name: string,
    email: string,
    password: string,
    captchaToken?: string,
  ): Observable<unknown> {
    return this.http.post(
      '/api/auth/sign-up/email',
      { name, email, password },
      captchaOptions(captchaToken),
    );
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

  /**
   * Asks the login worker to email a password-reset link (better-auth's
   * `request-password-reset`). `redirectTo` is where the email link lands after
   * the token is validated — our `/reset-password` page, which reads the appended
   * `?token=`. Resolves whether or not the email exists (no enumeration).
   */
  requestPasswordReset(
    email: string,
    redirectTo: string,
    captchaToken?: string,
  ): Observable<unknown> {
    return this.http.post(
      '/api/auth/request-password-reset',
      { email, redirectTo },
      captchaOptions(captchaToken),
    );
  }

  /**
   * Completes a password reset with the token from the email link. Propagates
   * errors (e.g. expired/invalid token) so the caller can surface a message.
   */
  resetPassword(newPassword: string, token: string): Observable<unknown> {
    return this.http.post('/api/auth/reset-password', { newPassword, token });
  }

  /** Ends the better-auth session and clears local + cached state. */
  signOut(): Observable<unknown> {
    const clear = () => {
      this.me.set(null);
      // Wipe every cached query so the next user never sees the prior session's data.
      this.queryClient.clear();
    };
    return this.http.post('/api/auth/sign-out', {}).pipe(
      tap(() => clear()),
      catchError(() => {
        clear();
        return of(null);
      }),
    );
  }
}

/**
 * Builds the HttpClient options carrying the Cloudflare Turnstile token in the
 * `x-captcha-response` header the login worker's captcha plugin reads. Returns an
 * empty object when no token is given (caller-side captcha not yet wired).
 */
function captchaOptions(captchaToken?: string): {
  headers?: HttpHeaders;
} {
  return captchaToken
    ? { headers: new HttpHeaders().set('x-captcha-response', captchaToken) }
    : {};
}
