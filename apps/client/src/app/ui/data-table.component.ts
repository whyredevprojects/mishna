import { NgTemplateOutlet } from '@angular/common';
import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  TemplateRef,
  contentChild,
  input,
  output,
  ChangeDetectionStrategy
} from '@angular/core';

/** One column of a {@link DataTableComponent}. `key` is matched in the cell template. */
export interface TableColumn {
  key: string;
  label: string;
  align?: 'start' | 'center' | 'end';
  width?: string;
}

/**
 * A minimal, presentational data table: it owns the chrome (header, rows, hover,
 * horizontal scroll) styled with Web Awesome tokens, and projects each cell through
 * a single `#cell` template the parent supplies (`$implicit` = row, `col` = the
 * column). Pagination/sort/filter are the parent's job (server-side), so this stays
 * deliberately thin — the seam to swap in a headless table (e.g. TanStack) later
 * without touching the pages. Rows are `unknown`; cast in the template (`$any`).
 *
 * ```html
 * <app-data-table [columns]="cols" [rows]="users()" [clickable]="true"
 *                 (rowClick)="open($any($event))">
 *   <ng-template #cell let-row let-col="col">
 *     @switch (col.key) { @case ('name') { {{ row.name }} } }
 *   </ng-template>
 * </app-data-table>
 * ```
 */
@Component({
  selector: 'app-data-table',
  imports: [NgTemplateOutlet],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .wrap {
        overflow-x: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--wa-font-size-s, 0.875rem);
      }
      th,
      td {
        padding: var(--wa-space-s, 0.5rem) var(--wa-space-m, 0.75rem);
        border-block-end: var(--wa-border-width-s, 1px) solid
          var(--wa-color-surface-border, #e5e0d8);
        text-align: start;
        vertical-align: middle;
      }
      th {
        color: var(--wa-color-text-quiet, #6b6358);
        font-weight: var(--wa-font-weight-semibold, 600);
        white-space: nowrap;
      }
      tbody tr.clickable {
        cursor: pointer;
      }
      tbody tr.clickable:hover {
        background: var(--wa-color-neutral-fill-quiet, #f0ece6);
      }
      .empty {
        padding: var(--wa-space-l, 1rem);
        text-align: center;
        color: var(--wa-color-text-quiet, #6b6358);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="wrap">
      <table>
        <thead>
          <tr>
            @for (col of columns(); track col.key) {
              <th
                [style.text-align]="col.align || 'start'"
                [style.width]="col.width || null"
              >
                {{ col.label }}
              </th>
            }
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track rowKey(row); let i = $index) {
            <tr
              [class.clickable]="clickable()"
              (click)="clickable() ? rowClick.emit(row) : null"
            >
              @for (col of columns(); track col.key) {
                <td [style.text-align]="col.align || 'start'">
                  <ng-container
                    [ngTemplateOutlet]="cell()"
                    [ngTemplateOutletContext]="{ $implicit: row, col: col, index: i }"
                  ></ng-container>
                </td>
              }
            </tr>
          } @empty {
            <tr>
              <td class="empty" [attr.colspan]="columns().length">
                {{ emptyText() }}
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class DataTableComponent {
  readonly columns = input.required<TableColumn[]>();
  readonly rows = input.required<readonly unknown[]>();
  readonly clickable = input(false);
  /** Row property used as the `@for` track key. */
  readonly trackKey = input('id');
  readonly emptyText = input($localize`Nothing to show.`);
  readonly rowClick = output<unknown>();

  protected readonly cell = contentChild.required<TemplateRef<unknown>>('cell');

  protected rowKey(row: unknown): unknown {
    return (row as Record<string, unknown>)[this.trackKey()];
  }
}
