import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  inject,
  signal,
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
import { queryKeys } from '../queries/query-keys';
import { cycleQueryOptions, meQueryOptions } from '../queries/queries';

/** Public landing page: site header + sign-in. Redirects to the dashboard if a
 * session already exists. New users follow the "Join here" link to /join. */
@Component({
  selector: 'app-landing',
  imports: [CycleProgressComponent, SiteHeaderComponent, RouterLink],
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
    `,
  ],
  template: `
    <app-site-header></app-site-header>

    <div class="fill-center">
      <wa-card>
        <h1 slot="header" class="center">Chevras Mishnayos</h1>

        <div class="stack">
          <p class="tagline center">
            Complete the entire Mishna together by Rosh Chodesh Sivan — one
            mishna at a time.
          </p>

          @if (cycleQuery.data(); as c) {
            <app-cycle-progress [cycle]="c"></app-cycle-progress>
          }

          <wa-input
            type="email"
            label="Email"
            autocomplete="email"
            [value]="email()"
            (input)="email.set($any($event.target).value)"
          ></wa-input>
          <wa-input
            type="password"
            label="Password"
            autocomplete="current-password"
            [value]="password()"
            (input)="password.set($any($event.target).value)"
            (keydown.enter)="logIn()"
          ></wa-input>

          @if (error(); as e) {
            <p class="error">{{ e }}</p>
          }

          <wa-button
            class="signin"
            variant="brand"
            [attr.loading]="loading() ? '' : null"
            (click)="logIn()"
          >
            Log in
          </wa-button>

          <wa-divider></wa-divider>

          <wa-button (click)="signInWithGoogle()">
            <wa-icon slot="start" name="google" family="brands"></wa-icon>
            Sign in with Google
          </wa-button>

          <p class="join-link center">
            New to the program?
            <a routerLink="/join">Join here</a>
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
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(false);

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
    if (this.loading()) return;
    this.error.set(null);
    this.loading.set(true);
    this.auth.signInWithEmail(this.email(), this.password()).subscribe({
      next: async () => {
        // New session — drop the cached (signed-out) `me` so the guard re-fetches.
        await this.queryClient.invalidateQueries({ queryKey: queryKeys.me });
        this.loading.set(false);
        this.router.navigate(['/dashboard']);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Incorrect email or password.');
      },
    });
  }

  protected signInWithGoogle(): void {
    this.auth.signInWithGoogle('/dashboard');
  }
}
