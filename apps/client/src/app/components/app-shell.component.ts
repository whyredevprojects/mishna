import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { GroupService } from '../services/group.service';

/**
 * Authenticated layout: a top bar with a burger that opens a navigation drawer,
 * and a router-outlet for the page. Also hosts the "leave group" confirmation.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
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
      .leave {
        margin-block-start: var(--wa-space-l, 1rem);
      }
    `,
  ],
  template: `
    <header class="topbar">
      <wa-button appearance="plain" (click)="drawerOpen.set(true)">
        <wa-icon name="bars" label="Menu"></wa-icon>
      </wa-button>
      <h1>Mishna Together</h1>
      <span class="spacer"></span>
    </header>

    <main class="page">
      <router-outlet />
    </main>

    <wa-drawer
      label="Mishna Together"
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
        <a routerLink="/admin" (click)="drawerOpen.set(false)">
          <wa-icon name="gear"></wa-icon> Admin
        </a>
      </nav>

      <wa-button
        slot="footer"
        class="leave"
        variant="danger"
        appearance="outlined"
        (click)="confirmOpen.set(true)"
      >
        <wa-icon slot="start" name="right-from-bracket"></wa-icon>
        Leave group
      </wa-button>
    </wa-drawer>

    <wa-dialog
      label="Leave the cycle?"
      [attr.open]="confirmOpen() ? '' : null"
      (wa-after-hide)="confirmOpen.set(false)"
    >
      Your mishnayot will be returned to the group for someone else to pick up.
      You can rejoin at any time.
      <wa-button slot="footer" appearance="plain" (click)="confirmOpen.set(false)">
        Cancel
      </wa-button>
      <wa-button
        slot="footer"
        variant="danger"
        [attr.loading]="leaving() ? '' : null"
        (click)="leave()"
      >
        Leave
      </wa-button>
    </wa-dialog>
  `,
})
export class AppShellComponent {
  private readonly groups = inject(GroupService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly drawerOpen = signal(false);
  protected readonly confirmOpen = signal(false);
  protected readonly leaving = signal(false);

  protected leave(): void {
    this.leaving.set(true);
    this.groups.leave().subscribe({
      next: () => {
        this.leaving.set(false);
        this.confirmOpen.set(false);
        this.drawerOpen.set(false);
        // Refresh membership, then land on the dashboard (now the join card).
        this.auth.loadSession().subscribe();
        this.router.navigate(['/dashboard']);
      },
      error: () => this.leaving.set(false),
    });
  }
}
