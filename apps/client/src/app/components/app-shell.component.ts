import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  inject,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { IS_HEBREW, heBundleUnavailableThisSession, switchLocale } from '../util/locale';

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
        <wa-icon name="bars" i18n-label label="Menu"></wa-icon>
      </wa-button>
      <h1 i18n="@@brand.title">Chevras Mishnayos Baal Peh</h1>
      <span class="spacer"></span>
      @if (!langSwitchHidden) {
        <wa-button class="lang-switch" appearance="plain" (click)="switchLocale()">{{ switcherLabel }}</wa-button>
      }
      <nav class="topbar-nav">
        <wa-button routerLink="/dashboard" appearance="plain"><wa-icon slot="start" name="calendar-day"></wa-icon> <span i18n="@@nav.today">Today</span></wa-button>
        <wa-button routerLink="/my-mishnayos" appearance="plain"><wa-icon slot="start" name="book"></wa-icon> <span i18n="@@nav.myMishnayos">My Mishnayos</span></wa-button>
        <wa-button routerLink="/review" appearance="plain"><wa-icon slot="start" name="magnifying-glass"></wa-icon> <span i18n="@@nav.review">Review</span></wa-button>
        <wa-button routerLink="/settings" appearance="plain"><wa-icon slot="start" name="user"></wa-icon> <span i18n="@@nav.settings">Settings</span></wa-button>
        @if (auth.isAdmin()) {
          <wa-button routerLink="/admin" appearance="plain"><wa-icon slot="start" name="gear"></wa-icon> <span i18n="@@nav.admin">Admin</span></wa-button>
        }
        <wa-button appearance="plain" (click)="logout()">
          <wa-icon slot="start" name="right-from-bracket"></wa-icon>
          <span i18n="@@nav.logout">Log out</span>
        </wa-button>
      </nav>
    </header>

    <main class="page">
      <router-outlet />
    </main>

    <wa-drawer
      i18n-label
      label="Chevras Mishnayos Baal Peh"
      placement="start"
      [attr.open]="drawerOpen() ? '' : null"
      (wa-after-hide)="drawerOpen.set(false)"
    >
      <nav>
        <wa-button routerLink="/dashboard" appearance="plain" (click)="drawerOpen.set(false)"><wa-icon slot="start" name="calendar-day"></wa-icon> <span i18n="@@nav.today">Today</span></wa-button>
        <wa-button routerLink="/my-mishnayos" appearance="plain" (click)="drawerOpen.set(false)"><wa-icon slot="start" name="book"></wa-icon> <span i18n="@@nav.myMishnayos">My Mishnayos</span></wa-button>
        <wa-button routerLink="/review" appearance="plain" (click)="drawerOpen.set(false)"><wa-icon slot="start" name="magnifying-glass"></wa-icon> <span i18n="@@nav.review">Review</span></wa-button>
        <wa-button routerLink="/settings" appearance="plain" (click)="drawerOpen.set(false)"><wa-icon slot="start" name="user"></wa-icon> <span i18n="@@nav.settings">Settings</span></wa-button>
        @if (auth.isAdmin()) {
          <wa-button routerLink="/admin" appearance="plain" (click)="drawerOpen.set(false)"><wa-icon slot="start" name="gear"></wa-icon> <span i18n="@@nav.admin">Admin</span></wa-button>
        }
        @if (!langSwitchHidden) {
          <wa-button class="lang-switch" appearance="plain" (click)="switchLocale()">{{ switcherLabel }}</wa-button>
        }
      </nav>

      <wa-button
        slot="footer"
        appearance="outlined"
        (click)="logout()"
      >
        <wa-icon slot="start" name="right-from-bracket"></wa-icon>
        <span i18n="@@nav.logout">Log out</span>
      </wa-button>
    </wa-drawer>

  `,
})
export class AppShellComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly drawerOpen = signal(false);

  protected readonly switcherLabel = IS_HEBREW ? 'English' : 'עברית';
  // Hide the toggle when the Hebrew bundle isn't served here this session (dev
  // serve): offering a control that no-ops is worse than not showing it.
  protected readonly langSwitchHidden = !IS_HEBREW && heBundleUnavailableThisSession();

  switchLocale(): void {
    switchLocale();
  }

  protected logout(): void {
    this.auth.signOut().subscribe(() => this.router.navigate(['/']));
  }
}
