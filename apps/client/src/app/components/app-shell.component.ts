import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  inject,
  signal,
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
      nav a {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s, 0.5rem);
        padding: var(--wa-space-s, 0.5rem) var(--wa-space-m, 0.75rem);
        border-radius: var(--wa-border-radius-m, 0.5rem);
        color: inherit;
        text-decoration: none;
        font-size: var(--wa-font-size-l, 1.125rem);
      }
      nav a:hover {
        background: var(--wa-color-neutral-fill-quiet, #f0ece6);
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

          a {
            display: flex;
            align-items: center;
            gap: var(--wa-space-2xs);
            padding: var(--wa-space-2xs) var(--wa-space-s);
            border-radius: var(--wa-border-radius-m);
            color: inherit;
            text-decoration: none;
          }
          a:hover {
            background: var(--wa-color-neutral-fill-quiet);
          }
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
        <a routerLink="/dashboard"><wa-icon name="calendar-day"></wa-icon> Today</a>
        <a routerLink="/review"><wa-icon name="magnifying-glass"></wa-icon> Review</a>
        <a routerLink="/settings"><wa-icon name="user"></wa-icon> Settings</a>
        @if (auth.isAdmin()) {
          <a routerLink="/admin"><wa-icon name="gear"></wa-icon> Admin</a>
        }
        <wa-button appearance="plain" size="small" (click)="logout()">
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
        <a routerLink="/dashboard" (click)="drawerOpen.set(false)">
          <wa-icon name="calendar-day"></wa-icon> Today
        </a>
        <a routerLink="/review" (click)="drawerOpen.set(false)">
          <wa-icon name="magnifying-glass"></wa-icon> Review
        </a>
        <a routerLink="/settings" (click)="drawerOpen.set(false)">
          <wa-icon name="user"></wa-icon> Settings
        </a>
        @if (auth.isAdmin()) {
          <a routerLink="/admin" (click)="drawerOpen.set(false)">
            <wa-icon name="gear"></wa-icon> Admin
          </a>
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
