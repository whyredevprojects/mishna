import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  inject,
  signal,
  viewChild,
  ChangeDetectionStrategy
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { AuthService } from '../services/auth.service';
import { SiteHeaderComponent } from '../components/site-header.component';
import { TurnstileComponent } from '../components/turnstile.component';
import { queryKeys } from '../queries/query-keys';

/** Public membership page. Creates an account via email/password or Google, then
 * lands on the dashboard where the commitment picker (JoinFormComponent) runs. */
@Component({
  selector: 'app-join',
  imports: [SiteHeaderComponent, TurnstileComponent, RouterLink],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      wa-card {
        width: 100%;
        max-width: 26rem;
      }
      wa-input {
        width: 100%;
      }
      .submit {
        margin-block-start: var(--wa-space-s, 0.5rem);
      }
      .error {
        color: var(--wa-color-danger-on-quiet, #b3261e);
        font-size: var(--wa-font-size-s, 0.875rem);
      }
      .login-link {
        font-size: var(--wa-font-size-s, 0.875rem);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <app-site-header></app-site-header>

    <div class="fill-center">
      <wa-card>
        <h1 slot="header" class="center">Become a Member</h1>

        <div class="stack">
          <wa-input
            label="Name"
            autocomplete="name"
            [value]="name()"
            (input)="name.set($any($event.target).value)"
          ></wa-input>
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
            autocomplete="new-password"
            [value]="password()"
            (input)="password.set($any($event.target).value)"
            (keydown.enter)="createAccount()"
          ></wa-input>

          <app-turnstile (verified)="captchaToken.set($event)"></app-turnstile>

          @if (error(); as e) {
            <p class="error">{{ e }}</p>
          }

          <wa-button
            class="submit"
            variant="brand"
            [attr.loading]="loading() ? '' : null"
            [attr.disabled]="captchaToken() ? null : ''"
            (click)="createAccount()"
          >
            Become a member
          </wa-button>

          <wa-divider></wa-divider>

          <wa-button
            [attr.loading]="googleLoading() ? '' : null"
            (click)="joinWithGoogle()"
          >
            <wa-icon slot="start" name="google" family="brands"></wa-icon>
            Join with Google
          </wa-button>

          @if (googleError()) {
            <p class="error center">
              Could not start Google sign-up. Please try again.
            </p>
          }

          <p class="login-link center">
            Already have an account?
            <a routerLink="/">Log in</a>
          </p>
        </div>
      </wa-card>
    </div>
  `,
})
export class JoinComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly queryClient = inject(QueryClient);

  private readonly turnstile = viewChild.required(TurnstileComponent);
  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly captchaToken = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly googleLoading = this.auth.googleSignInLoading;
  protected readonly googleError = this.auth.googleSignInError;

  protected createAccount(): void {
    const token = this.captchaToken();
    if (this.loading() || !token) return;
    this.error.set(null);
    this.loading.set(true);
    this.auth
      .signUpWithEmail(this.name(), this.email(), this.password(), token)
      .subscribe({
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
          this.error.set(
            'Could not create the account. The email may already be registered, or the password is too short.',
          );
          // The Turnstile token was consumed by this attempt; get a fresh one so a
          // retry isn't rejected for reusing it.
          this.captchaToken.set(null);
          this.turnstile().reset();
        },
      });
  }

  protected joinWithGoogle(): void {
    this.auth.signInWithGoogle('/dashboard');
  }
}
