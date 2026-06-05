import { CUSTOM_ELEMENTS_SCHEMA, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { AdminService } from '../services/admin.service';
import { AdminGroupDetail } from '../models/api.types';
import { adminGroupQueryOptions } from '../queries/queries';
import { DataTableComponent, TableColumn } from '../ui/data-table.component';

/** One group: progress plus its members (identity, verification, block size). */
@Component({
  selector: 'app-admin-group-detail',
  imports: [RouterLink, DataTableComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-m, 0.75rem);
      }
      .pct {
        font-variant-numeric: tabular-nums;
      }
      .back {
        font-size: var(--wa-font-size-s, 0.875rem);
      }
    `,
  ],
  template: `
    <div class="stack">
      <a class="back" routerLink="/admin/groups">← All groups</a>
      @if (query.isPending()) {
        <wa-spinner style="font-size: 2rem"></wa-spinner>
      } @else if (query.isError()) {
        <wa-callout variant="danger">Could not load this group.</wa-callout>
      } @else if (query.data(); as g) {
        <wa-card>
          <div slot="header" class="head">
            <strong>{{ g.memberCount }} {{ g.memberCount === 1 ? 'member' : 'members' }}</strong>
            <span class="pct">{{ pct(g) }}% covered</span>
          </div>
          <wa-progress-bar [value]="pct(g)"></wa-progress-bar>
        </wa-card>

        <app-data-table
          [columns]="columns"
          [rows]="g.members"
          emptyText="No members."
        >
          <ng-template #cell let-row let-col="col">
            @switch (col.key) {
              @case ('name') {
                <a [routerLink]="['/admin/users', row.id]">{{
                  row.name || '(no name)'
                }}</a>
              }
              @case ('email') {
                <span class="muted">{{ row.email }}</span>
              }
              @case ('blockSize') {
                {{ row.blockSize }}
              }
              @case ('verified') {
                @if (row.emailVerified) {
                  <wa-tag size="small" variant="success">Verified</wa-tag>
                } @else {
                  <wa-tag size="small" variant="warning">Pending</wa-tag>
                }
              }
            }
          </ng-template>
        </app-data-table>
      }
    </div>
  `,
})
export class AdminGroupDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly admin = inject(AdminService);

  private readonly id = this.route.snapshot.paramMap.get('id') ?? '';

  protected readonly query = injectQuery(() =>
    adminGroupQueryOptions(this.admin, this.id),
  );

  protected readonly columns: TableColumn[] = [
    { key: 'name', label: 'Member' },
    { key: 'email', label: 'Email' },
    { key: 'blockSize', label: 'Mishnayos', align: 'end' },
    { key: 'verified', label: 'Verified' },
  ];

  protected pct(g: AdminGroupDetail): number {
    return Math.round(g.progress * 100);
  }
}
