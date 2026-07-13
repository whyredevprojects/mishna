import { CUSTOM_ELEMENTS_SCHEMA, Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { AdminService } from '../services/admin.service';
import { AdminGroup } from '../models/api.types';
import { adminGroupsQueryOptions } from '../queries/queries';
import { DataTableComponent, TableColumn } from '../ui/data-table.component';

/** Every group as a table; a row opens that group's detail page. */
@Component({
  selector: 'app-admin-groups',
  imports: [DataTableComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .bar {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s, 0.5rem);
      }
      .bar wa-progress-bar {
        flex: 1;
        min-width: 6rem;
      }
      .pct {
        font-variant-numeric: tabular-nums;
        min-width: 3rem;
        text-align: end;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="stack">
      @if (query.isPending()) {
        <wa-spinner style="font-size: 2rem"></wa-spinner>
      } @else if (query.isError()) {
        <wa-callout variant="danger">Could not load groups.</wa-callout>
      } @else if (query.data(); as res) {
        <p class="muted">
          {{ res.count }} active {{ res.count === 1 ? 'group' : 'groups' }}
        </p>
        <app-data-table
          [columns]="columns"
          [rows]="res.groups"
          [clickable]="true"
          emptyText="No groups yet."
          (rowClick)="open($any($event))"
        >
          <ng-template #cell let-row let-col="col" let-i="index">
            @switch (col.key) {
              @case ('name') {
                <strong>Group {{ i + 1 }}</strong>
              }
              @case ('members') {
                {{ row.memberCount }}
              }
              @case ('progress') {
                <div class="bar">
                  <wa-progress-bar [value]="pct(row)"></wa-progress-bar>
                  <span class="pct">{{ pct(row) }}%</span>
                </div>
              }
            }
          </ng-template>
        </app-data-table>
      }
    </div>
  `,
})
export class AdminGroupsComponent {
  private readonly admin = inject(AdminService);
  private readonly router = inject(Router);

  protected readonly query = injectQuery(() =>
    adminGroupsQueryOptions(this.admin),
  );

  protected readonly columns: TableColumn[] = [
    { key: 'name', label: 'Group' },
    { key: 'members', label: 'Members' },
    { key: 'progress', label: 'Progress', width: '50%' },
  ];

  protected pct(group: AdminGroup): number {
    return Math.round(group.progress * 100);
  }

  protected open(group: AdminGroup): void {
    this.router.navigate(['/admin/groups', group.id]);
  }
}
