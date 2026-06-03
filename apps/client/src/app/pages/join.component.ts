import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { SiteHeaderComponent } from '../components/site-header.component';

/** Public signup page. Creates an account via email/password or Google, then
 * lands on the dashboard where the commitment picker (JoinFormComponent) runs. */
@Component({
  selector: 'app-join',
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
      .login-link {
        font-size: var(--wa-font-size-s, 0.875rem);
      }
    `,
  ],
  template: `
    <app-site-header></app-site-header>

    <div class="fill-center">
      <wa-card>
        <h1 slot="header" class="center">Join the Program</h1>

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

          @if (error(); as e) {
            <p class="error">{{ e }}</p>
          }

          <wa-button
            class="submit"
            variant="brand"
            [attr.loading]="loading() ? '' : null"
            (click)="createAccount()"
          >
            Create account
          </wa-button>

          <wa-divider></wa-divider>

          <wa-button (click)="joinWithGoogle()">
            <wa-icon slot="start" name="google" family="brands"></wa-icon>
            Join with Google
          </wa-button>

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

  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(false);

  protected createAccount(): void {
    if (this.loading()) return;
    this.error.set(null);
    this.loading.set(true);
    this.auth
      .signUpWithEmail(this.name(), this.email(), this.password())
      .subscribe({
        next: () => {
          this.auth.loadSession().subscribe(() => {
            this.loading.set(false);
            this.router.navigate(['/dashboard']);
          });
        },
        error: () => {
          this.loading.set(false);
          this.error.set(
            'Could not create the account. The email may already be registered, or the password is too short.',
          );
        },
      });
  }

  protected joinWithGoogle(): void {
    this.auth.signInWithGoogle('/dashboard');
  }
}
