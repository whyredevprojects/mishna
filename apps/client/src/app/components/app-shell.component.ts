import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
import { ToastService } from '../services/toast.service';

/** Authenticated layout: a top bar with a burger that opens a navigation drawer, and a router-outlet for the page. */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      @use 'breakpoints' as bp;

      .topbar {
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        align-items: center;
        gap: var(--wa-space-s, 0.5rem);
        padding: var(--wa-space-m, 0.75rem) var(--wa-space-l, 1rem);
        background: var(--wa-color-surface-default, #fff);
        border-block-end: var(--wa-border-width-s, 1px) solid
          var(--wa-color-surface-border, #e5e0d8);
      }
      .topbar h1 {
        font-size: var(--wa-font-size-l, 1.125rem);
        margin: 0;
      }
      .spacer {
        flex: 1;
      }

      /* Drawer nav (mobile) */
      nav {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs, 0.125rem);
      }
      /* Inline topbar nav (tablet+) */
      .topbar-nav {
        display: none;
      }

      @media (min-width: bp.$tablet) {
        .burger {
          display: none;
        }

        .topbar-nav {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: var(--wa-space-2xs);
        }
      }
    `,
  ],
  template: `
    <header class="topbar">
      <wa-button class="burger" appearance="plain" (click)="drawerOpen.set(true)">
        <wa-icon name="bars" label="Menu"></wa-icon>
      </wa-button>
      <h1>Chevras Mishnayos</h1>
      <span class="spacer"></span>
      <nav class="topbar-nav">
        <wa-button routerLink="/dashboard" appearance="plain"><wa-icon slot="start" name="calendar-day"></wa-icon> Today</wa-button>
        <wa-button routerLink="/chaluka" appearance="plain"><wa-icon slot="start" name="chart-simple"></wa-icon> My Chaluka</wa-button>
        <wa-button routerLink="/review" appearance="plain"><wa-icon slot="start" name="magnifying-glass"></wa-icon> Review</wa-button>
        <wa-button routerLink="/settings" appearance="plain"><wa-icon slot="start" name="user"></wa-icon> Settings</wa-button>
        @if (auth.isAdmin()) {
          <wa-button routerLink="/admin" appearance="plain"><wa-icon slot="start" name="gear"></wa-icon> Admin</wa-button>
        }
        <wa-button appearance="plain" (click)="logout()">
          <wa-icon slot="start" name="right-from-bracket"></wa-icon>
          Log out
        </wa-button>
      </nav>
    </header>

    <main class="page">
      <router-outlet />
    </main>

    <wa-drawer
      label="Chevras Mishnayos"
      placement="start"
      [attr.open]="drawerOpen() ? '' : null"
      (wa-after-hide)="drawerOpen.set(false)"
    >
      <nav>
        <wa-button routerLink="/dashboard" appearance="plain" (click)="drawerOpen.set(false)"><wa-icon slot="start" name="calendar-day"></wa-icon> Today</wa-button>
        <wa-button routerLink="/chaluka" appearance="plain" (click)="drawerOpen.set(false)"><wa-icon slot="start" name="chart-simple"></wa-icon> My Chaluka</wa-button>
        <wa-button routerLink="/review" appearance="plain" (click)="drawerOpen.set(false)"><wa-icon slot="start" name="magnifying-glass"></wa-icon> Review</wa-button>
        <wa-button routerLink="/settings" appearance="plain" (click)="drawerOpen.set(false)"><wa-icon slot="start" name="user"></wa-icon> Settings</wa-button>
        @if (auth.isAdmin()) {
          <wa-button routerLink="/admin" appearance="plain" (click)="drawerOpen.set(false)"><wa-icon slot="start" name="gear"></wa-icon> Admin</wa-button>
        }
      </nav>

      <wa-button
        slot="footer"
        appearance="outlined"
        (click)="logout()"
      >
        <wa-icon slot="start" name="right-from-bracket"></wa-icon>
        Log out
      </wa-button>
    </wa-drawer>

  `,
})
export class AppShellComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly swUpdate = inject(SwUpdate);

  protected readonly drawerOpen = signal(false);

  constructor() {
    // When a freshly deployed version finishes downloading in the background,
    // prompt the user to reload onto it (no-op in dev, where the SW is off).
    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates
        .pipe(
          filter(
            (e): e is VersionReadyEvent => e.type === 'VERSION_READY',
          ),
          takeUntilDestroyed(inject(DestroyRef)),
        )
        .subscribe(() => {
          this.toast.action(
            'A new version is available.',
            'Reload',
            () => document.location.reload(),
          );
        });
    }
  }

  protected logout(): void {
    this.auth.signOut().subscribe(() => this.router.navigate(['/']));
  }
}
