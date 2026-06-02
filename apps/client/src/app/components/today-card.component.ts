import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  computed,
  effect,
  input,
  signal,
} from '@angular/core';
import { MishnaRef } from '../models/api.types';
import { formatRef } from '../util/format';

/**
 * The prominent "today's mishnayot" checklist. Each mishna is a checkbox; when
 * all are checked the card shows a completion state.
 *
 * Completion is persisted to localStorage keyed by date — a stand-in until the
 * server grows a completions endpoint (`POST /api/assignments/done`), at which
 * point this should sync instead.
 */
@Component({
  selector: 'app-today-card',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      wa-checkbox {
        display: block;
        padding-block: var(--wa-space-xs, 0.25rem);
        font-size: var(--wa-font-size-l, 1.125rem);
      }
      .done-banner {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s, 0.5rem);
        color: var(--wa-color-success-on-quiet, #1a7f37);
        font-weight: var(--wa-font-weight-semibold, 600);
        margin-block-start: var(--wa-space-m, 0.75rem);
      }
    `,
  ],
  template: `
    <wa-card>
      <strong slot="header">Today's Mishnayot</strong>

      @if (mishnas().length) {
        @for (ref of mishnas(); track key(ref)) {
          <wa-checkbox
            [attr.checked]="isChecked(key(ref)) ? '' : null"
            (change)="toggle(key(ref), $event)"
            >{{ format(ref) }}</wa-checkbox
          >
        }

        @if (allDone()) {
          <div class="done-banner">
            <wa-icon name="circle-check" variant="solid"></wa-icon>
            Done for today!
          </div>
        }
      } @else {
        <p class="muted">No mishnayot assigned today.</p>
      }
    </wa-card>
  `,
})
export class TodayCardComponent {
  readonly mishnas = input.required<MishnaRef[]>();
  /** ISO date the assignment belongs to; namespaces the saved checked state. */
  readonly date = input.required<string>();

  protected readonly format = formatRef;
  protected readonly key = formatRef;

  private readonly checked = signal<Set<string>>(new Set());

  constructor() {
    // Restore saved checks whenever the date changes.
    effect(() => {
      this.checked.set(this.load(this.date()));
    });
  }

  protected isChecked(refKey: string): boolean {
    return this.checked().has(refKey);
  }

  protected readonly allDone = computed(() => {
    const refs = this.mishnas();
    return refs.length > 0 && refs.every((r) => this.checked().has(formatRef(r)));
  });

  protected toggle(refKey: string, event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    const next = new Set(this.checked());
    if (on) {
      next.add(refKey);
    } else {
      next.delete(refKey);
    }
    this.checked.set(next);
    this.save(this.date(), next);
  }

  private storageKey(date: string): string {
    return `mishna:done:${date}`;
  }

  private load(date: string): Set<string> {
    if (typeof localStorage === 'undefined') {
      return new Set();
    }
    try {
      const raw = localStorage.getItem(this.storageKey(date));
      return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  }

  private save(date: string, refs: Set<string>): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      localStorage.setItem(this.storageKey(date), JSON.stringify([...refs]));
    } catch {
      // Storage may be unavailable (private mode); checks just won't persist.
    }
  }
}
