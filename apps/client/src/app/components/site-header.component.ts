import { CUSTOM_ELEMENTS_SCHEMA, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Public top bar for the unauthenticated pages (landing, join). Site name on the
 * left; a subtle "Log in" and an emphasized "Join the Program" on the right.
 */
@Component({
  selector: 'app-site-header',
  imports: [RouterLink],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .topbar {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s, 0.5rem);
        padding: var(--wa-space-m, 0.75rem) var(--wa-space-l, 1rem);
        background: var(--wa-color-surface-default, #fff);
        border-block-end: var(--wa-border-width-s, 1px) solid
          var(--wa-color-surface-border, #e5e0d8);
      }
      .brand {
        font-size: var(--wa-font-size-l, 1.125rem);
        font-weight: var(--wa-font-weight-bold, 700);
        color: inherit;
        text-decoration: none;
      }
      .spacer {
        flex: 1;
      }
    `,
  ],
  template: `
    <header class="topbar">
      <a class="brand" routerLink="/">Chevras Mishnayos</a>
      <span class="spacer"></span>
      <wa-button appearance="plain" routerLink="/">Log in</wa-button>
      <wa-button variant="brand" routerLink="/join">Join the Program</wa-button>
    </header>
  `,
})
export class SiteHeaderComponent {}
