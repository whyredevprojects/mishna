import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { CycleService } from '../services/cycle.service';
import { Cycle } from '../models/api.types';
import { CycleProgressComponent } from '../components/cycle-progress.component';

/** Public landing page. Redirects to the dashboard if a session already exists. */
@Component({
  selector: 'app-landing',
  imports: [CycleProgressComponent],
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
      .signin {
        margin-block-start: var(--wa-space-l, 1rem);
      }
    `,
  ],
  template: `
    <div class="fill-center">
      <wa-card>
        <h1 slot="header" class="center">Mishna Together</h1>

        <div class="stack">
          <p class="tagline center">
            Complete the entire Mishna together by Rosh Chodesh Sivan — one
            mishna at a time.
          </p>

          @if (cycle(); as c) {
            <app-cycle-progress [cycle]="c"></app-cycle-progress>
          }

          <wa-button class="signin" variant="brand" (click)="signIn()">
            <wa-icon slot="start" name="google" family="brands"></wa-icon>
            Sign in with Google
          </wa-button>
        </div>
      </wa-card>
    </div>
  `,
})
export class LandingComponent {
  private readonly auth = inject(AuthService);
  private readonly cycleService = inject(CycleService);
  private readonly router = inject(Router);

  protected readonly cycle = signal<Cycle | null>(null);

  constructor() {
    this.cycleService.getCycle().subscribe({
      next: (c) => this.cycle.set(c),
      error: () => this.cycle.set(null),
    });
    // If already signed in, skip the landing page.
    this.auth.loadSession().subscribe((me) => {
      if (me) {
        this.router.navigate(['/dashboard']);
      }
    });
  }

  protected signIn(): void {
    this.auth.signInWithGoogle('/dashboard');
  }
}
