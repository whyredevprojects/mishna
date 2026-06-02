import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  computed,
  input,
} from '@angular/core';
import { Cycle } from '../models/api.types';

/** Cycle progress bar + "N days remaining" caption. */
@Component({
  selector: 'app-cycle-progress',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .label {
        display: flex;
        justify-content: space-between;
        font-size: var(--wa-font-size-s, 0.875rem);
        margin-block-end: var(--wa-space-xs, 0.25rem);
      }
    `,
  ],
  template: `
    <div>
      <div class="label">
        <span class="muted">Cycle progress</span>
        <span>Day {{ cycle().daysElapsed }} / {{ cycle().totalDays }}</span>
      </div>
      <wa-progress-bar [value]="percent()"></wa-progress-bar>
      <p class="muted center" style="margin-block: var(--wa-space-xs);">
        {{ cycle().daysRemaining }} days remaining until Rosh Chodesh Sivan
      </p>
    </div>
  `,
})
export class CycleProgressComponent {
  readonly cycle = input.required<Cycle>();

  protected readonly percent = computed(() => {
    const c = this.cycle();
    return c.totalDays > 0 ? Math.round((c.daysElapsed / c.totalDays) * 100) : 0;
  });
}
