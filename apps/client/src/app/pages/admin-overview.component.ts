import { DatePipe } from '@angular/common';
import { CUSTOM_ELEMENTS_SCHEMA, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { AdminService } from '../services/admin.service';
import {
  adminStatsQueryOptions,
  adminUsersQueryOptions,
} from '../queries/queries';
import { DataTableComponent, TableColumn } from '../ui/data-table.component';
import { AdminStats } from '../models/api.types';

/** Admin Overview: headline counters, quick links, and the most recent signups. */
@Component({
  selector: 'app-admin-overview',
  imports: [RouterLink, DatePipe, DataTableComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
        gap: var(--wa-space-m, 0.75rem);
      }
      .stat {
        text-align: center;
      }
      .stat .n {
        font-size: var(--wa-font-size-2xl, 1.75rem);
        font-weight: var(--wa-font-weight-bold, 700);
        font-variant-numeric: tabular-nums;
      }
      .stat .label {
        color: var(--wa-color-text-quiet, #6b6358);
        font-size: var(--wa-font-size-s, 0.875rem);
      }
      .actions {
        display: flex;
        gap: var(--wa-space-s, 0.5rem);
        flex-wrap: wrap;
      }
      .section-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
    `,
  ],
  template: `
    <div class="stack">
      @if (stats.isError()) {
        <wa-callout variant="danger">Could not load stats.</wa-callout>
      }
      <div class="cards">
        @for (s of statCards; track s.label) {
          <wa-card class="stat">
            <div class="n">{{ statValue(s.key) }}</div>
            <div class="label">{{ s.label }}</div>
          </wa-card>
        }
      </div>

      <wa-card>
        <strong slot="header">Quick actions</strong>
        <div class="actions">
          <wa-button appearance="outlined" routerLink="/admin/users">
            <wa-icon slot="start" name="users"></wa-icon>
            Manage users
          </wa-button>
          <wa-button appearance="outlined" routerLink="/admin/assignments">
            <wa-icon slot="start" name="book"></wa-icon>
            Assignments
          </wa-button>
          <wa-button appearance="outlined" routerLink="/admin/groups">
            <wa-icon slot="start" name="layer-group"></wa-icon>
            Groups
          </wa-button>
        </div>
      </wa-card>

      <wa-card>
        <div slot="header" class="section-head">
          <strong>Recent signups</strong>
          <a routerLink="/admin/users">View all</a>
        </div>
        @if (recent.isPending()) {
          <wa-spinner style="font-size: 2rem"></wa-spinner>
        } @else if (recent.isError()) {
          <wa-callout variant="danger">Could not load signups.</wa-callout>
        } @else {
          <app-data-table
            [columns]="columns"
            [rows]="recent.data()?.users ?? []"
            emptyText="No signups yet."
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
                @case ('goal') {
                  {{ row.joined ? row.commitment + '/day' : '—' }}
                }
                @case ('joined') {
                  {{ row.createdAt ? (row.createdAt | date: 'mediumDate') : '—' }}
                }
                @case ('verified') {
                  @if (row.emailVerified) {
                    <wa-tag size="small" variant="success">Verified</wa-tag>
                  } @else {
                    <wa-tag size="small">Pending</wa-tag>
                  }
                }
              }
            </ng-template>
          </app-data-table>
        }
      </wa-card>
    </div>
  `,
})
export class AdminOverviewComponent {
  private readonly admin = inject(AdminService);

  protected readonly stats = injectQuery(() =>
    adminStatsQueryOptions(this.admin),
  );

  protected readonly recent = injectQuery(() =>
    adminUsersQueryOptions(this.admin, {
      limit: 7,
      offset: 0,
      sort: 'createdAt:desc',
    }),
  );

  protected readonly columns: TableColumn[] = [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'goal', label: 'Goal' },
    { key: 'joined', label: 'Signed up' },
    { key: 'verified', label: 'Verified' },
  ];

  protected readonly statCards: { key: keyof AdminStats; label: string }[] = [
    { key: 'activeUsers', label: 'Active users' },
    { key: 'verifiedUsers', label: 'Verified' },
    { key: 'totalGroups', label: 'Groups' },
    { key: 'totalCompletions', label: 'Total learned' },
    { key: 'weekCompletions', label: 'Learned this week' },
  ];

  protected statValue(key: keyof AdminStats): string {
    const data = this.stats.data();
    if (!data) return '…';
    return String(data[key]);
  }
}
