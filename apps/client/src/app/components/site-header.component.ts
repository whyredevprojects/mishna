import { CUSTOM_ELEMENTS_SCHEMA, Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IS_HEBREW, switchLocale } from '../util/locale';

/**
 * Public top bar for the unauthenticated pages (landing, join). Site name on the
 * left; a subtle "Log in" and an emphasized "Become a Member" on the right.
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
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <header class="topbar">
      <a class="brand" routerLink="/" i18n="@@brand.title">Chevras Mishnayos Baal Peh</a>
      <span class="spacer"></span>
      <wa-button class="lang-switch" appearance="plain" (click)="switchLocale()">{{ switcherLabel }}</wa-button>
      <wa-button appearance="plain" routerLink="/" i18n="@@header.logIn">Log in</wa-button>
      <wa-button variant="brand" routerLink="/join" i18n="@@header.becomeMember">Become a Member</wa-button>
    </header>
  `,
})
export class SiteHeaderComponent {
  protected readonly switcherLabel = IS_HEBREW ? 'English' : 'עברית';

  switchLocale(): void {
    switchLocale();
  }
}
