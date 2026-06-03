import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MishnaRef } from '../models/api.types';
import { MishnaText, MishnaTextService } from '../services/mishna-text.service';
import { formatRef, formatRefHe } from '../util/format';

/**
 * One mishna: its Hebrew text, an English toggle, and the "I Learned This Baal
 * Peh" completion button. Text is loaded on demand from {@link MishnaTextService};
 * completion state is owned by the parent (see TodayCardComponent).
 */
@Component({
  selector: 'app-mishna-card',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--wa-space-s, 0.5rem);
      }
      .header .he {
        direction: rtl;
        color: var(--wa-color-text-quiet, #6b6b6b);
        font-weight: var(--wa-font-weight-normal, 400);
      }
      .hebrew {
        direction: rtl;
        text-align: center;
        font-size: var(--wa-font-size-l, 1.25rem);
        line-height: 2;
      }
      .english {
        margin-block-start: var(--wa-space-m, 0.75rem);
        padding-block-start: var(--wa-space-m, 0.75rem);
        border-block-start: var(--wa-border-width-s, 1px) solid
          var(--wa-color-surface-border, #d8d2c8);
        line-height: 1.6;
        color: var(--wa-color-text-quiet, #6b6b6b);
      }
      .spinner-wrap {
        display: flex;
        justify-content: center;
        padding-block: var(--wa-space-l, 1rem);
      }
      .footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--wa-space-s, 0.5rem);
      }
    `,
  ],
  template: `
    <wa-card>
      <div slot="header" class="header">
        <strong>{{ format(ref()) }}</strong>
        @if (text(); as t) {
          <span class="he">{{
            formatHe(t.tractateHebrewName, ref().perek, ref().mishna)
          }}</span>
        }
      </div>

      @if (loading()) {
        <div class="spinner-wrap"><wa-spinner></wa-spinner></div>
      } @else if (text(); as t) {
        <p class="hebrew">{{ t.hebrew }}</p>
        @if (showEnglish()) {
          <p class="english">{{ t.english }}</p>
        }
      } @else {
        <p class="muted">Text unavailable for this mishna.</p>
      }

      <div slot="footer" class="footer">
        <wa-button appearance="outlined" (click)="showEnglish.set(!showEnglish())">
          <wa-icon slot="start" name="language"></wa-icon>
          {{ showEnglish() ? 'Hide English' : 'English' }}
        </wa-button>
        <wa-button
          variant="success"
          [attr.appearance]="done() ? 'filled' : 'accent'"
          (click)="learned.emit()"
        >
          <wa-icon slot="start" name="circle-check" variant="solid"></wa-icon>
          {{ done() ? 'Learned Baal Peh' : 'I Learned This Baal Peh' }}
        </wa-button>
      </div>
    </wa-card>
  `,
})
export class MishnaCardComponent {
  readonly ref = input.required<MishnaRef>();
  readonly done = input.required<boolean>();
  readonly learned = output<void>();

  protected readonly format = formatRef;
  protected readonly formatHe = formatRefHe;

  protected readonly text = signal<MishnaText | null>(null);
  protected readonly loading = signal(true);
  protected readonly showEnglish = signal(false);

  private readonly textService = inject(MishnaTextService);
  private loadToken = 0;

  constructor() {
    // (Re)load text whenever the ref changes; ignore stale resolutions.
    effect(() => {
      const ref = this.ref();
      const token = ++this.loadToken;
      this.loading.set(true);
      this.showEnglish.set(false);
      this.textService
        .lookup(ref)
        .then((t) => {
          if (token === this.loadToken) {
            this.text.set(t);
          }
        })
        .catch(() => {
          if (token === this.loadToken) {
            this.text.set(null);
          }
        })
        .finally(() => {
          if (token === this.loadToken) {
            this.loading.set(false);
          }
        });
    });
  }
}
