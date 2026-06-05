import { CUSTOM_ELEMENTS_SCHEMA, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/**
 * "My Mishnayos" shell: a local sub-nav (Assignments / Stats) over a nested
 * router-outlet for the user's whole-cycle portion views. Mirrors the admin
 * shell's tab pattern.
 */
@Component({
  selector: 'app-my-mishnayos',
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
  template: `
    <div class="stack">
      <h2>My Mishnayos</h2>
      <nav class="subnav">
        <a
          routerLink="/my-mishnayos"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: true }"
          >Assignments</a
        >
        <a routerLink="/my-mishnayos/stats" routerLinkActive="active">Stats</a>
      </nav>
      <router-outlet />
    </div>
  `,
})
export class MyMishnayosComponent {}
