import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  computed,
  input,
  output,
  ChangeDetectionStrategy
} from '@angular/core';

/**
 * Presentational pager: "X–Y of N" with prev/next. Server-side paging — the parent
 * owns the page index (a signal) and refetches on `pageChange`. Zero-based `page`.
 * Part of the in-app table seam (see `data-table.component.ts`).
 */
@Component({
  selector: 'app-paginator',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .pager {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-m, 0.75rem);
        margin-block-start: var(--wa-space-s, 0.5rem);
      }
      .btns {
        display: flex;
        gap: var(--wa-space-xs, 0.25rem);
      }
      .range {
        font-variant-numeric: tabular-nums;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="pager">
      <span class="range muted">{{ rangeLabel() }}</span>
      <div class="btns">
        <wa-button
          size="small"
          appearance="outlined"
          [attr.disabled]="page() === 0 ? '' : null"
          (click)="go(page() - 1)"
        >
          <wa-icon slot="start" name="chevron-left"></wa-icon>
          Prev
        </wa-button>
        <wa-button
          size="small"
          appearance="outlined"
          [attr.disabled]="isLast() ? '' : null"
          (click)="go(page() + 1)"
        >
          Next
          <wa-icon slot="end" name="chevron-right"></wa-icon>
        </wa-button>
      </div>
    </div>
  `,
})
export class PaginatorComponent {
  /** Zero-based current page. */
  readonly page = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly total = input.required<number>();
  /** Emits the new zero-based page index. */
  readonly pageChange = output<number>();

  protected readonly isLast = computed(
    () => (this.page() + 1) * this.pageSize() >= this.total(),
  );

  protected readonly rangeLabel = computed(() => {
    if (this.total() === 0) return '0 of 0';
    const start = this.page() * this.pageSize() + 1;
    const end = Math.min(this.total(), (this.page() + 1) * this.pageSize());
    return `${start}–${end} of ${this.total()}`;
  });

  protected go(p: number): void {
    if (p < 0 || p * this.pageSize() >= this.total()) return;
    this.pageChange.emit(p);
  }
}
