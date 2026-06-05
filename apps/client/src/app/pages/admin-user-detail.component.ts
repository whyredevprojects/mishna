import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';
import { AdminService } from '../services/admin.service';
import { AuthService } from '../services/auth.service';
import { ToastService } from '../services/toast.service';
import { AdminUserDetail } from '../models/api.types';
import { queryKeys } from '../queries/query-keys';
import { adminUserQueryOptions } from '../queries/queries';

/** One user's info, with admin actions: remove assignments and delete account. */
@Component({
  selector: 'app-admin-user-detail',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      dl {
        margin: 0;
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--wa-space-2xs, 0.125rem) var(--wa-space-m, 0.75rem);
      }
      dt {
        color: var(--wa-color-text-quiet, #6b6358);
      }
      dd {
        margin: 0;
        word-break: break-all;
      }
      .mono {
        font-family: var(--wa-font-family-code, monospace);
        font-size: var(--wa-font-size-s, 0.875rem);
      }
      .actions {
        display: flex;
        gap: var(--wa-space-s, 0.5rem);
        flex-wrap: wrap;
      }
    `,
  ],
  template: `
    <div class="stack">
      @if (query.isPending()) {
        <wa-spinner style="font-size: 2rem"></wa-spinner>
      } @else if (query.isError()) {
        <wa-callout variant="danger">Could not load this user.</wa-callout>
      } @else if (query.data(); as u) {
        <wa-card>
          <strong slot="header">{{ u.name || '(no name)' }}</strong>
          <dl>
            <dt>Email</dt>
            <dd>
              {{ u.email }}
              @if (u.emailVerified) {
                <wa-tag size="small" variant="success">Verified</wa-tag>
              } @else {
                <wa-tag size="small" variant="warning">Pending</wa-tag>
              }
            </dd>
            <dt>User ID</dt>
            <dd class="mono">{{ u.id }}</dd>
            <dt>Role</dt>
            <dd>{{ u.role || 'user' }}</dd>
            <dt>Status</dt>
            <dd>
              {{ u.joined ? 'Joined — ' + u.commitment + '/day' : 'Not joined' }}
            </dd>
            <dt>Groups</dt>
            <dd>
              @if (u.groups.length) {
                {{ u.groups.length }}
                ({{ totalMishnayot(u) }} mishnayos)
              } @else {
                none
              }
            </dd>
          </dl>
        </wa-card>

        <div class="actions">
          <wa-button
            appearance="outlined"
            [attr.disabled]="!u.joined || sending() ? '' : null"
            (click)="send('weekly')"
          >
            <wa-icon slot="start" name="envelope"></wa-icon>
            Send weekly email
          </wa-button>
          <wa-button
            appearance="outlined"
            [attr.disabled]="!u.joined || sending() ? '' : null"
            (click)="send('reminder')"
          >
            <wa-icon slot="start" name="bell"></wa-icon>
            Send reminder email
          </wa-button>
          <wa-button
            variant="warning"
            appearance="outlined"
            [attr.disabled]="!u.joined ? '' : null"
            (click)="removeOpen.set(true)"
          >
            <wa-icon slot="start" name="eraser"></wa-icon>
            Remove assignments
          </wa-button>
          <wa-button
            variant="danger"
            [attr.disabled]="isSelf() ? '' : null"
            (click)="deleteOpen.set(true)"
          >
            <wa-icon slot="start" name="trash"></wa-icon>
            Delete account
          </wa-button>
        </div>
        @if (isSelf()) {
          <p class="muted">You can't delete your own account here.</p>
        }
      }
    </div>

    <wa-dialog
      label="Remove this user's assignments?"
      [attr.open]="removeOpen() ? '' : null"
      (wa-after-hide)="removeOpen.set(false)"
    >
      Their mishnayot are returned to their groups for someone else to pick up.
      Their account stays intact and they can rejoin.
      <wa-button slot="footer" appearance="plain" (click)="removeOpen.set(false)">
        Cancel
      </wa-button>
      <wa-button
        slot="footer"
        variant="warning"
        [attr.loading]="working() ? '' : null"
        (click)="removeAssignments()"
      >
        Remove assignments
      </wa-button>
    </wa-dialog>

    <wa-dialog
      label="Delete this account?"
      [attr.open]="deleteOpen() ? '' : null"
      (wa-after-hide)="deleteOpen.set(false)"
    >
      This permanently deletes the user and frees any assignments they hold. This
      can't be undone.
      <wa-button slot="footer" appearance="plain" (click)="deleteOpen.set(false)">
        Cancel
      </wa-button>
      <wa-button
        slot="footer"
        variant="danger"
        [attr.loading]="working() ? '' : null"
        (click)="deleteUser()"
      >
        Delete account
      </wa-button>
    </wa-dialog>
  `,
})
export class AdminUserDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly admin = inject(AdminService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly queryClient = inject(QueryClient);

  private readonly id = this.route.snapshot.paramMap.get('id') ?? '';

  protected readonly removeOpen = signal(false);
  protected readonly deleteOpen = signal(false);
  protected readonly sending = signal(false);

  protected readonly query = injectQuery(() =>
    adminUserQueryOptions(this.admin, this.id),
  );

  protected readonly removeMutation = injectMutation(() => ({
    mutationFn: () => firstValueFrom(this.admin.removeAssignments(this.id)),
    onSuccess: () => {
      this.removeOpen.set(false);
      // Freed ranges change this user, their groups, and the joined flag in lists.
      this.queryClient.invalidateQueries({
        queryKey: queryKeys.adminUser(this.id),
      });
      this.queryClient.invalidateQueries({ queryKey: queryKeys.adminGroups });
      this.queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
    },
  }));

  protected readonly deleteMutation = injectMutation(() => ({
    mutationFn: () => firstValueFrom(this.admin.deleteUser(this.id)),
    onSuccess: () => {
      this.deleteOpen.set(false);
      this.queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
      this.queryClient.invalidateQueries({ queryKey: queryKeys.adminGroups });
      this.router.navigate(['/admin/users']);
    },
  }));

  protected readonly working = computed(
    () => this.removeMutation.isPending() || this.deleteMutation.isPending(),
  );

  protected isSelf(): boolean {
    return this.auth.me()?.user.id === this.id;
  }

  protected totalMishnayot(u: AdminUserDetail): number {
    return u.groups.reduce((sum, g) => sum + g.blockSize, 0);
  }

  protected send(kind: 'weekly' | 'reminder'): void {
    this.sending.set(true);
    const req =
      kind === 'weekly'
        ? this.admin.sendWeekly(this.id)
        : this.admin.sendReminder(this.id);
    req.subscribe({
      next: () => {
        this.sending.set(false);
        this.toast.success(
          kind === 'weekly' ? 'Weekly email sent.' : 'Reminder email sent.',
        );
      },
      error: (err: HttpErrorResponse) => {
        this.sending.set(false);
        const detail =
          typeof err.error?.detail === 'string' ? err.error.detail : null;
        this.toast.error(
          detail ? `Could not send the email: ${detail}` : 'Could not send the email.',
        );
      },
    });
  }


  protected removeAssignments(): void {
    this.removeMutation.mutate();
  }

  protected deleteUser(): void {
    this.deleteMutation.mutate();
  }
}
