import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { Commitment } from '../models/api.types';

/** Commitment picker (1/2/3 mishnayot per week) + Join button. */
@Component({
  selector: 'app-join-form',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .actions {
        margin-block-start: var(--wa-space-l, 1rem);
      }
    `,
  ],
  template: `
    <wa-card>
      <strong slot="header">Join the current cycle</strong>

      <p>How many mishnayot will you learn each week?</p>

      <wa-radio-group
        [value]="String(selected())"
        orientation="horizontal"
        (change)="onSelect($event)"
      >
        <wa-radio appearance="button" value="1">1</wa-radio>
        <wa-radio appearance="button" value="2">2</wa-radio>
        <wa-radio appearance="button" value="3">3</wa-radio>
      </wa-radio-group>

      <div class="actions">
        <wa-button
          variant="brand"
          [attr.loading]="loading() ? '' : null"
          (click)="submit()"
        >
          Join
        </wa-button>
      </div>
    </wa-card>
  `,
})
export class JoinFormComponent {
  readonly loading = input(false);
  readonly join = output<Commitment>();

  protected readonly String = String;
  protected readonly selected = signal<Commitment>(1);

  protected onSelect(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (value === 1 || value === 2 || value === 3) {
      this.selected.set(value);
    }
  }

  protected submit(): void {
    this.join.emit(this.selected());
  }
}
