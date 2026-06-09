import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { SiteHeaderComponent } from '../components/site-header.component';
import { TurnstileComponent } from '../components/turnstile.component';

/** Public "forgot password" page: collects an email and asks the login worker to
 * send a reset link. Always shows the same neutral confirmation (no enumeration). */
@Component({
  selector: 'app-forgot-password',
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
        <h1 slot="header" class="center">Reset your password</h1>

        <div class="stack">
          @if (sent()) {
            <p class="tagline center">
              If an account exists for that email, we've sent a link to reset
              your password. Check your inbox.
            </p>
          } @else {
            <p class="tagline">
              Enter your email and we'll send you a link to set a new password.
            </p>

            <wa-input
              type="email"
              label="Email"
              autocomplete="email"
              [value]="email()"
              (input)="email.set($any($event.target).value)"
              (keydown.enter)="submit()"
            ></wa-input>

            <app-turnstile
              (verified)="captchaToken.set($event)"
            ></app-turnstile>

            <wa-button
              class="submit"
              variant="brand"
              [attr.loading]="loading() ? '' : null"
              [attr.disabled]="captchaToken() ? null : ''"
              (click)="submit()"
            >
              Send reset link
            </wa-button>
          }

          <p class="login-link center">
            Remembered it?
            <a routerLink="/">Log in</a>
          </p>
        </div>
      </wa-card>
    </div>
  `,
})
export class ForgotPasswordComponent {
  private readonly auth = inject(AuthService);

  protected readonly email = signal('');
  protected readonly captchaToken = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly sent = signal(false);

  protected submit(): void {
    const token = this.captchaToken();
    if (this.loading() || !this.email() || !token) return;
    this.loading.set(true);
    const redirectTo = `${window.location.origin}/reset-password`;
    this.auth.requestPasswordReset(this.email(), redirectTo, token).subscribe({
      // Same outcome on success or failure — never reveal whether the email exists.
      next: () => {
        this.loading.set(false);
        this.sent.set(true);
      },
      error: () => {
        this.loading.set(false);
        this.sent.set(true);
      },
    });
  }
}
