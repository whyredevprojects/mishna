import { Component, input } from '@angular/core';
import { MishnaRef } from '../models/api.types';
import { formatRef } from '../util/format';

/** Renders a list of mishna references as plain, formatted rows. */
@Component({
  selector: 'app-mishna-list',
  styles: [
    `
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-xs, 0.25rem);
      }
      li {
        padding-block: var(--wa-space-2xs, 0.125rem);
        font-size: var(--wa-font-size-l, 1.125rem);
      }
      .empty {
        color: var(--wa-color-text-quiet, #6b6b6b);
      }
    `,
  ],
  template: `
    @if (mishnas().length) {
      <ul>
        @for (ref of mishnas(); track $index) {
          <li>{{ format(ref) }}</li>
        }
      </ul>
    } @else {
      <p class="empty">Nothing assigned for this day.</p>
    }
  `,
})
export class MishnaListComponent {
  readonly mishnas = input.required<MishnaRef[]>();
  protected readonly format = formatRef;
}
