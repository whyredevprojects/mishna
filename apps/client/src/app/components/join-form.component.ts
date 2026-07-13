import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  effect,
  input,
  output,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';
import { Commitment, JoinOption } from '../models/api.types';

/**
 * Commitment picker + Join button. Choices are still framed as mishnayot per
 * week, but each one shows roughly how many lots (chalakim) it commits to from
 * now to the end of the cycle — fewer as the cycle progresses, collapsing to a
 * single "1 lot" option near the end. The options come from the server
 * (`/api/join-options`) so the lot math lives in one place.
 */
@Component({
  selector: 'app-join-form',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .options {
        --wa-form-control-label-gap: 0;
      }
      .option-main {
        font-weight: var(--wa-font-weight-bold, 600);
      }
      .option-sub {
        display: block;
        color: var(--wa-color-text-quiet, #666);
        font-size: var(--wa-font-size-s, 0.875rem);
      }
      .actions {
        margin-block-start: var(--wa-space-l, 1rem);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <wa-card>
      <strong slot="header">Join the current cycle</strong>

      <p>How many mishnayot will you memorize each week?</p>

      @if (options(); as opts) {
        <wa-radio-group
          class="options"
          [value]="String(selected())"
          orientation="vertical"
          (change)="onSelect($event)"
        >
          @for (o of opts; track o.commitment) {
            <wa-radio appearance="button" [value]="String(o.commitment)">
              <span class="option-main">{{ mainLabel(o) }}</span>
              <span class="option-sub">{{ subLabel(o) }}</span>
            </wa-radio>
          }
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
      } @else {
        <wa-spinner></wa-spinner>
      }
    </wa-card>
  `,
})
export class JoinFormComponent {
  readonly loading = input(false);
  /** Commitment choices from the server; undefined while loading. */
  readonly options = input<JoinOption[] | undefined>(undefined);
  readonly join = output<Commitment>();

  protected readonly String = String;
  protected readonly selected = signal<Commitment>(1);

  constructor() {
    // Default the selection to the first offered option once they arrive (the
    // previously-selected pace may have been dropped near the cycle end).
    effect(() => {
      const opts = this.options();
      if (opts && !opts.some((o) => o.commitment === this.selected())) {
        this.selected.set(opts[0]?.commitment ?? 1);
      }
    });
  }

  protected mainLabel(o: JoinOption): string {
    if (o.singleLot) {
      return '1 lot';
    }
    const noun = o.commitment === 1 ? 'mishna' : 'mishnayos';
    return `${o.commitment} ${noun} a week`;
  }

  protected subLabel(o: JoinOption): string {
    if (o.singleLot) {
      return `up to ${o.maxMishnas} mishnayos · about ${o.perDay} a day`;
    }
    return `about ${o.approxLots} ${o.approxLots === 1 ? 'lot' : 'lots'}`;
  }

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
