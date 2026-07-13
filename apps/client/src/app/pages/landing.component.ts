import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  inject,
  signal,
  viewChild,
  ChangeDetectionStrategy
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { AuthService } from '../services/auth.service';
import { CycleService } from '../services/cycle.service';
import { CycleProgressComponent } from '../components/cycle-progress.component';
import { SiteHeaderComponent } from '../components/site-header.component';
import { TurnstileComponent } from '../components/turnstile.component';
import { queryKeys } from '../queries/query-keys';
import { cycleQueryOptions, meQueryOptions } from '../queries/queries';

/** Public landing page: site header + sign-in. Redirects to the dashboard if a
 * session already exists. New users follow the "Become a member" link to /join. */
@Component({
  selector: 'app-landing',
  imports: [
    CycleProgressComponent,
    SiteHeaderComponent,
    TurnstileComponent,
    RouterLink,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      wa-card {
        width: 100%;
        max-width: 26rem;
      }
      .tagline {
        font-size: var(--wa-font-size-l, 1.125rem);
        line-height: 1.5;
      }
      wa-input {
        width: 100%;
      }
      .signin {
        margin-block-start: var(--wa-space-s, 0.5rem);
      }
      .error {
        color: var(--wa-color-danger-on-quiet, #b3261e);
        font-size: var(--wa-font-size-s, 0.875rem);
      }
      .join-link {
        font-size: var(--wa-font-size-s, 0.875rem);
      }
      .forgot-link {
        font-size: var(--wa-font-size-s, 0.875rem);
        margin-block: 0;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <app-site-header></app-site-header>

    <div class="fill-center">
      <wa-card>
        <h1 slot="header" class="center" i18n="@@brand.title">Chevras Mishnayos Baal Peh</h1>

        <div class="stack">
          <p class="tagline center" i18n="@@landing.tagline">
            Memorize the entire Mishna together by Rosh Chodesh Sivan — one
            mishna at a time.
          </p>

          @if (cycleQuery.data(); as c) {
            <app-cycle-progress [cycle]="c"></app-cycle-progress>
          }

          <wa-input
            type="email"
            i18n-label="@@field.email"
            label="Email"
            autocomplete="email"
            [value]="email()"
            (input)="email.set($any($event.target).value)"
          ></wa-input>
          <wa-input
            type="password"
            i18n-label="@@field.password"
            label="Password"
            autocomplete="current-password"
            [value]="password()"
            (input)="password.set($any($event.target).value)"
            (keydown.enter)="logIn()"
          ></wa-input>

          <app-turnstile (verified)="captchaToken.set($event)"></app-turnstile>

          @if (error(); as e) {
            <p class="error">{{ e }}</p>
          }

          <wa-button
            class="signin"
            variant="brand"
            [attr.loading]="loading() ? '' : null"
            [attr.disabled]="captchaToken() ? null : ''"
            (click)="logIn()"
          >
            <span i18n="@@header.logIn">Log in</span>
          </wa-button>

          <p class="forgot-link center">
            <a routerLink="/forgot-password" i18n="@@landing.forgotPassword">Forgot your password?</a>
          </p>

          <wa-divider></wa-divider>

          <wa-button
            [attr.loading]="googleLoading() ? '' : null"
            (click)="signInWithGoogle()"
          >
            <wa-icon slot="start" name="google" family="brands"></wa-icon>
            <span i18n="@@landing.signInGoogle">Sign in with Google</span>
          </wa-button>

          @if (googleError()) {
            <p class="error center" i18n="@@landing.googleError">
              Could not start Google sign-in. Please try again.
            </p>
          }

          <p class="join-link center" i18n="@@landing.joinPrompt">
            New to the program?
            <a routerLink="/join">Become a member</a>
          </p>
        </div>
      </wa-card>
    </div>
  `,
})
export class LandingComponent {
  private readonly auth = inject(AuthService);
  private readonly cycleService = inject(CycleService);
  private readonly router = inject(Router);
  private readonly queryClient = inject(QueryClient);

  protected readonly cycleQuery = injectQuery(() =>
    cycleQueryOptions(this.cycleService),
  );
  private readonly turnstile = viewChild.required(TurnstileComponent);
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly captchaToken = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly googleLoading = this.auth.googleSignInLoading;
  protected readonly googleError = this.auth.googleSignInError;

  constructor() {
    // If already signed in, skip the landing page. `fetchQuery` also warms the
    // `me` cache so the route guard reuses it instead of re-fetching.
    this.queryClient.fetchQuery(meQueryOptions(this.auth)).then((me) => {
      if (me) {
        this.router.navigate(['/dashboard']);
      }
    });
  }

  protected logIn(): void {
    const token = this.captchaToken();
    if (this.loading() || !token) return;
    this.error.set(null);
    this.loading.set(true);
    this.auth.signInWithEmail(this.email(), this.password(), token).subscribe({
      next: async () => {
        // New session — refetch `me` now so the route guard sees the signed-in user
        // (invalidateQueries only marks stale; ensureQueryData would still read the
        // cached signed-out value).
        await this.queryClient.refetchQueries({ queryKey: queryKeys.me });
        this.loading.set(false);
        this.router.navigate(['/dashboard']);
      },
      error: () => {
        this.loading.set(false);
        this.error.set($localize`:@@landing.errorBadCredentials:Incorrect email or password.`);
        // The Turnstile token was consumed by this attempt; get a fresh one so a
        // retry isn't rejected for reusing it.
        this.captchaToken.set(null);
        this.turnstile().reset();
      },
    });
  }

  protected signInWithGoogle(): void {
    this.auth.signInWithGoogle('/dashboard');
  }
}
