import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  inject,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from '../services/auth.service';

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
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <header class="topbar">
      <wa-button class="burger" appearance="plain" (click)="drawerOpen.set(true)">
        <wa-icon name="bars" label="Menu"></wa-icon>
      </wa-button>
      <h1>Chevras Mishnayos Baal Peh</h1>
      <span class="spacer"></span>
      <nav class="topbar-nav">
        <wa-button routerLink="/dashboard" appearance="plain"><wa-icon slot="start" name="calendar-day"></wa-icon> Today</wa-button>
        <wa-button routerLink="/my-mishnayos" appearance="plain"><wa-icon slot="start" name="book"></wa-icon> My Mishnayos</wa-button>
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
      label="Chevras Mishnayos Baal Peh"
      placement="start"
      [attr.open]="drawerOpen() ? '' : null"
      (wa-after-hide)="drawerOpen.set(false)"
    >
      <nav>
        <wa-button routerLink="/dashboard" appearance="plain" (click)="drawerOpen.set(false)"><wa-icon slot="start" name="calendar-day"></wa-icon> Today</wa-button>
        <wa-button routerLink="/my-mishnayos" appearance="plain" (click)="drawerOpen.set(false)"><wa-icon slot="start" name="book"></wa-icon> My Mishnayos</wa-button>
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

  protected readonly drawerOpen = signal(false);

  protected logout(): void {
    this.auth.signOut().subscribe(() => this.router.navigate(['/']));
  }
}
