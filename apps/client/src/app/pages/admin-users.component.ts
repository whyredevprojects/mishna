import { CUSTOM_ELEMENTS_SCHEMA, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { AdminService } from '../services/admin.service';
import { adminUsersQueryOptions } from '../queries/queries';

/** Lists every user; each row links to that user's detail page. */
@Component({
  selector: 'app-admin-users',
  imports: [RouterLink],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .user {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-3xs, 0.0625rem);
        padding: var(--wa-space-s, 0.5rem) var(--wa-space-m, 0.75rem);
        border-radius: var(--wa-border-radius-m, 0.5rem);
        color: inherit;
        text-decoration: none;
        border: var(--wa-border-width-s, 1px) solid
          var(--wa-color-surface-border, #e5e0d8);
      }
      .user:hover {
        background: var(--wa-color-neutral-fill-quiet, #f0ece6);
      }
      .name {
        font-weight: var(--wa-font-weight-semibold, 600);
      }
      .email {
        font-size: var(--wa-font-size-s, 0.875rem);
      }
    `,
  ],
  template: `
    <div class="stack">
      @if (query.isPending()) {
        <wa-spinner style="font-size: 2rem"></wa-spinner>
      } @else if (query.isError()) {
        <wa-callout variant="danger">Could not load users.</wa-callout>
      } @else if (query.data()?.users; as users) {
        <p class="muted">
          {{ users.length }} {{ users.length === 1 ? 'user' : 'users' }}
        </p>
        @for (user of users; track user.id) {
          <a class="user" [routerLink]="['/admin/users', user.id]">
            <span class="name">{{ user.name || '(no name)' }}</span>
            <span class="email muted">{{ user.email }}</span>
            @if (user.joined) {
              <wa-tag size="small" variant="success"
                >{{ user.commitment }}/day</wa-tag
              >
            } @else {
              <wa-tag size="small">not joined</wa-tag>
            }
          </a>
        }
      }
    </div>
  `,
})
export class AdminUsersComponent {
  private readonly admin = inject(AdminService);

  protected readonly query = injectQuery(() =>
    adminUsersQueryOptions(this.admin),
  );
}
