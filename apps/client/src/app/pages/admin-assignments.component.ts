import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  inject,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { AdminService } from '../services/admin.service';
import { ToastService } from '../services/toast.service';
import { AdminAssignmentRow } from '../models/api.types';
import { adminAssignmentsQueryOptions } from '../queries/queries';
import { queryKeys } from '../queries/query-keys';
import { DataTableComponent, TableColumn } from '../ui/data-table.component';
import { PaginatorComponent } from '../ui/paginator.component';
import { formatRef, sundayOnOrBefore } from '../util/format';

const PAGE_SIZE = 50;

/**
 * Per-user view of a chosen week's mishnayot, with email + completion status and
 * inline actions (send weekly/reminder; mark the whole week learned or unlearn it).
 */
@Component({
  selector: 'app-admin-assignments',
  imports: [DataTableComponent, PaginatorComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .toolbar {
        display: flex;
        gap: var(--wa-space-s, 0.5rem);
        align-items: end;
      }
      .row-actions {
        display: flex;
        gap: var(--wa-space-2xs, 0.125rem);
        flex-wrap: wrap;
      }
      .count {
        font-variant-numeric: tabular-nums;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="stack">
      <div class="toolbar">
        <wa-select
          label="Week"
          [value]="week()"
          (change)="onWeek($any($event.target).value)"
        >
          @for (w of weeks; track w) {
            <wa-option [value]="w">Week of {{ w }}</wa-option>
          }
        </wa-select>
      </div>

      @if (query.isPending()) {
        <wa-spinner style="font-size: 2rem"></wa-spinner>
      } @else if (query.isError()) {
        <wa-callout variant="danger">Could not load assignments.</wa-callout>
      } @else if (query.data(); as data) {
        <app-data-table
          [columns]="columns"
          [rows]="data.rows"
          trackKey="userId"
          emptyText="No participants for this week."
        >
          <ng-template #cell let-row let-col="col">
            @switch (col.key) {
              @case ('user') {
                <strong>{{ row.name || '(no name)' }}</strong>
                <div class="muted">{{ row.email }}</div>
              }
              @case ('mishnas') {
                {{ range(row) }}
              }
              @case ('progress') {
                <span class="count"
                  >{{ doneCount(row) }} / {{ row.mishnas.length }}</span
                >
              }
              @case ('email') {
                @if (row.emailSent) {
                  <wa-tag size="small" variant="success">Sent</wa-tag>
                } @else {
                  <wa-tag size="small">No</wa-tag>
                }
              }
              @case ('actions') {
                <div class="row-actions">
                  <wa-button
                    size="small"
                    appearance="outlined"
                    [attr.disabled]="isBusy(row) || !row.email ? '' : null"
                    (click)="send(row, 'weekly')"
                    >Send</wa-button
                  >
                  <wa-button
                    size="small"
                    appearance="outlined"
                    [attr.disabled]="isBusy(row) || !row.email ? '' : null"
                    (click)="send(row, 'reminder')"
                    >Remind</wa-button
                  >
                  @if (row.mishnas.length) {
                    @if (allDone(row)) {
                      <wa-button
                        size="small"
                        variant="warning"
                        appearance="outlined"
                        [attr.disabled]="isBusy(row) ? '' : null"
                        (click)="setLearned(row, false)"
                        >Unmark</wa-button
                      >
                    } @else {
                      <wa-button
                        size="small"
                        variant="success"
                        appearance="outlined"
                        [attr.disabled]="isBusy(row) ? '' : null"
                        (click)="setLearned(row, true)"
                        >Mark memorized</wa-button
                      >
                    }
                  }
                </div>
              }
            }
          </ng-template>
        </app-data-table>

        <app-paginator
          [page]="page()"
          [pageSize]="pageSize"
          [total]="data.total"
          (pageChange)="page.set($event)"
        ></app-paginator>
      }
    </div>
  `,
})
export class AdminAssignmentsComponent {
  private readonly admin = inject(AdminService);
  private readonly toast = inject(ToastService);
  private readonly queryClient = inject(QueryClient);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly page = signal(0);
  protected readonly week = signal(sundayOnOrBefore(new Date()));
  /** userIds with an action in flight (disables their row buttons). */
  private readonly busy = signal<ReadonlySet<string>>(new Set());

  /** A window of recent + upcoming weeks (newest first) for the selector. */
  protected readonly weeks = this.buildWeeks();

  protected readonly query = injectQuery(() =>
    adminAssignmentsQueryOptions(this.admin, {
      limit: this.pageSize,
      offset: this.page() * this.pageSize,
      week: this.week(),
    }),
  );

  protected readonly columns: TableColumn[] = [
    { key: 'user', label: 'User' },
    { key: 'mishnas', label: 'Mishnayos' },
    { key: 'progress', label: 'Done', align: 'center' },
    { key: 'email', label: 'Email sent', align: 'center' },
    { key: 'actions', label: 'Actions' },
  ];

  protected onWeek(value: string): void {
    if (!value || value === this.week()) return;
    this.page.set(0);
    this.week.set(value);
  }

  protected doneCount(row: AdminAssignmentRow): number {
    return row.mishnas.filter((m) => m.done).length;
  }

  protected allDone(row: AdminAssignmentRow): boolean {
    return row.mishnas.length > 0 && row.mishnas.every((m) => m.done);
  }

  protected range(row: AdminAssignmentRow): string {
    const ms = row.mishnas;
    if (ms.length === 0) return '—';
    const first = formatRef(ms[0]);
    const last = formatRef(ms[ms.length - 1]);
    return first === last ? first : `${first} – ${last}`;
  }

  protected isBusy(row: AdminAssignmentRow): boolean {
    return this.busy().has(row.userId);
  }

  protected send(row: AdminAssignmentRow, kind: 'weekly' | 'reminder'): void {
    this.mark(row.userId, true);
    const req =
      kind === 'weekly'
        ? this.admin.sendWeekly(row.userId)
        : this.admin.sendReminder(row.userId);
    req.subscribe({
      next: () => {
        this.mark(row.userId, false);
        this.toast.success(kind === 'weekly' ? 'Weekly email sent.' : 'Reminder sent.');
        this.queryClient.invalidateQueries({ queryKey: queryKeys.adminAssignments });
      },
      error: (err: HttpErrorResponse) => {
        this.mark(row.userId, false);
        const detail = typeof err.error?.detail === 'string' ? err.error.detail : null;
        this.toast.error(detail ? `Could not send: ${detail}` : 'Could not send the email.');
      },
    });
  }

  /** Mark/unmark every mishna of the week for one user, via the per-ref endpoints. */
  protected async setLearned(
    row: AdminAssignmentRow,
    learned: boolean,
  ): Promise<void> {
    const targets = row.mishnas.filter(
      (m) => m.groupId && m.done !== learned,
    );
    if (targets.length === 0) return;
    this.mark(row.userId, true);
    try {
      for (const m of targets) {
        const target = {
          ref: { mesechta: m.mesechta, perek: m.perek, mishna: m.mishna },
          groupId: m.groupId as string,
        };
        await firstValueFrom(
          learned
            ? this.admin.markLearned(row.userId, target)
            : this.admin.unlearn(row.userId, target),
        );
      }
      await this.queryClient.invalidateQueries({
        queryKey: queryKeys.adminAssignments,
      });
    } catch {
      this.toast.error('Could not update completions.');
    } finally {
      this.mark(row.userId, false);
    }
  }

  private mark(userId: string, busy: boolean): void {
    const next = new Set(this.busy());
    if (busy) next.add(userId);
    else next.delete(userId);
    this.busy.set(next);
  }

  private buildWeeks(): string[] {
    const base = new Date();
    const out: string[] = [];
    for (let i = 6; i >= -10; i--) {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + i * 7);
      out.push(sundayOnOrBefore(d));
    }
    return out;
  }
}
