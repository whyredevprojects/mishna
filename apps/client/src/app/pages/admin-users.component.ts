import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  inject,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { AdminService } from '../services/admin.service';
import { AdminUser } from '../models/api.types';
import { adminUsersQueryOptions } from '../queries/queries';
import { DataTableComponent, TableColumn } from '../ui/data-table.component';
import { PaginatorComponent } from '../ui/paginator.component';

const PAGE_SIZE = 50;

/** Paginated, searchable user directory; each row opens that user's detail page. */
@Component({
  selector: 'app-admin-users',
  imports: [DatePipe, DataTableComponent, PaginatorComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .toolbar {
        display: flex;
        gap: var(--wa-space-s, 0.5rem);
        align-items: end;
      }
      .toolbar wa-input {
        flex: 1;
        max-width: 22rem;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="stack">
      <div class="toolbar">
        <wa-input
          placeholder="Search name or email…"
          [value]="searchInput()"
          (input)="searchInput.set($any($event.target).value)"
          (keydown.enter)="applySearch()"
        ></wa-input>
        <wa-button appearance="outlined" (click)="applySearch()">Search</wa-button>
      </div>

      @if (query.isPending()) {
        <wa-spinner style="font-size: 2rem"></wa-spinner>
      } @else if (query.isError()) {
        <wa-callout variant="danger">Could not load users.</wa-callout>
      } @else if (query.data(); as data) {
        <app-data-table
          [columns]="columns"
          [rows]="data.users"
          [clickable]="true"
          emptyText="No matching users."
          (rowClick)="open($any($event))"
        >
          <ng-template #cell let-row let-col="col">
            @switch (col.key) {
              @case ('name') {
                @if (row.role === 'admin') {
                  <wa-icon
                    name="shield-halved"
                    title="Admin"
                    style="margin-inline-end: var(--wa-space-2xs, 0.25rem)"
                  ></wa-icon>
                }
                <strong>{{ row.name || '(no name)' }}</strong>
              }
              @case ('email') {
                <span class="muted">{{ row.email }}</span>
              }
              @case ('goal') {
                {{ row.joined ? row.commitment + '/week' : '—' }}
              }
              @case ('joined') {
                {{ row.createdAt ? (row.createdAt | date: 'mediumDate') : '—' }}
              }
              @case ('verified') {
                @if (row.emailVerified) {
                  <wa-tag size="small" variant="success">Verified</wa-tag>
                } @else {
                  <wa-tag size="small" variant="warning">Pending</wa-tag>
                }
              }
              @case ('status') {
                @if (row.joined) {
                  <wa-tag size="small" variant="success">Active</wa-tag>
                } @else {
                  <wa-tag size="small">Not joined</wa-tag>
                }
                @if (!row.weeklyEnabled && !row.reminderEnabled) {
                  <wa-tag size="small" variant="warning">Emails off</wa-tag>
                } @else if (!row.weeklyEnabled) {
                  <wa-tag size="small" variant="warning">Weekly off</wa-tag>
                } @else if (!row.reminderEnabled) {
                  <wa-tag size="small" variant="warning">Reminders off</wa-tag>
                }
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
export class AdminUsersComponent {
  private readonly admin = inject(AdminService);
  private readonly router = inject(Router);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly page = signal(0);
  /** The applied search (drives the query); `searchInput` is the unsubmitted box. */
  protected readonly search = signal('');
  protected readonly searchInput = signal('');

  protected readonly query = injectQuery(() =>
    adminUsersQueryOptions(this.admin, {
      limit: this.pageSize,
      offset: this.page() * this.pageSize,
      search: this.search() || undefined,
      sort: 'createdAt:desc',
    }),
  );

  protected readonly columns: TableColumn[] = [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'goal', label: 'Goal' },
    { key: 'joined', label: 'Joined' },
    { key: 'verified', label: 'Verified' },
    { key: 'status', label: 'Status' },
  ];

  protected applySearch(): void {
    this.page.set(0);
    this.search.set(this.searchInput().trim());
  }

  protected open(user: AdminUser): void {
    this.router.navigate(['/admin/users', user.id]);
  }
}
