import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { SiteHeaderComponent } from '../components/site-header.component';

/** Public "reset password" page: the landing spot for the emailed reset link.
 * better-auth appends `?token=` on success or `?error=INVALID_TOKEN` if the token
 * was bad/expired. With a valid token the user sets a new password here. */
@Component({
  selector: 'app-reset-password',
  imports: [SiteHeaderComponent, RouterLink],
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
      .tagline {
        font-size: var(--wa-font-size-s, 0.875rem);
        color: var(--wa-color-neutral-on-quiet, #555);
      }
      .login-link {
        font-size: var(--wa-font-size-s, 0.875rem);
      }
    `,
  ],
  template: `
    <app-site-header></app-site-header>

    <div class="fill-center">
      <wa-card>
        <h1 slot="header" class="center">Choose a new password</h1>

        <div class="stack">
          @if (done()) {
            <p class="tagline center">
              Your password has been reset. You can now log in with it.
            </p>
            <p class="login-link center"><a routerLink="/">Log in</a></p>
          } @else if (!token()) {
            <p class="error">
              This reset link is invalid or has expired.
            </p>
            <p class="login-link center">
              <a routerLink="/forgot-password">Request a new link</a>
            </p>
          } @else {
            <wa-input
              type="password"
              label="New password"
              autocomplete="new-password"
              [value]="password()"
              (input)="password.set($any($event.target).value)"
              (keydown.enter)="submit()"
            ></wa-input>

            @if (error(); as e) {
              <p class="error">{{ e }}</p>
            }

            <wa-button
              class="submit"
              variant="brand"
              [attr.loading]="loading() ? '' : null"
              (click)="submit()"
            >
              Reset password
            </wa-button>
          }
        </div>
      </wa-card>
    </div>
  `,
})
export class ResetPasswordComponent {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  // `error=INVALID_TOKEN` means the link was already bad; treat it as no token.
  private readonly params = this.route.snapshot.queryParamMap;
  protected readonly token = signal(
    this.params.get('error') ? '' : (this.params.get('token') ?? ''),
  );
  protected readonly password = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly done = signal(false);

  protected submit(): void {
    if (this.loading()) return;
    if (!this.password()) {
      this.error.set('Please enter a new password.');
      return;
    }
    this.error.set(null);
    this.loading.set(true);
    this.auth.resetPassword(this.password(), this.token()).subscribe({
      next: () => {
        this.loading.set(false);
        this.done.set(true);
      },
      error: () => {
        this.loading.set(false);
        this.error.set(
          'Could not reset the password. The link may have expired, or the password is too short.',
        );
      },
    });
  }
}
