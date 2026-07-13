import { CUSTOM_ELEMENTS_SCHEMA, Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/**
 * Admin shell: a local sub-nav (Groups / Users) and a nested router-outlet for
 * the admin pages. Gated by `adminGuard` in the route config.
 */
@Component({
  selector: 'app-admin',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .subnav {
        display: flex;
        gap: var(--wa-space-xs, 0.25rem);
        margin-block-end: var(--wa-space-m, 0.75rem);
      }
      .subnav a {
        padding: var(--wa-space-2xs, 0.125rem) var(--wa-space-s, 0.5rem);
        border-radius: var(--wa-border-radius-m, 0.5rem);
        color: inherit;
        text-decoration: none;
        font-size: var(--wa-font-size-l, 1.125rem);
      }
      .subnav a:hover {
        background: var(--wa-color-neutral-fill-quiet, #f0ece6);
      }
      .subnav a.active {
        background: var(--wa-color-brand-fill-quiet, #f0e6d8);
        font-weight: var(--wa-font-weight-semibold, 600);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="stack">
      <h2>Admin</h2>
      <nav class="subnav">
        <a
          routerLink="/admin"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: true }"
          >Overview</a
        >
        <a routerLink="/admin/users" routerLinkActive="active">Users</a>
        <a routerLink="/admin/groups" routerLinkActive="active">Groups</a>
        <a routerLink="/admin/assignments" routerLinkActive="active">Assignments</a>
        <a routerLink="/admin/about" routerLinkActive="active">About page</a>
      </nav>
      <router-outlet />
    </div>
  `,
})
export class AdminComponent {}
