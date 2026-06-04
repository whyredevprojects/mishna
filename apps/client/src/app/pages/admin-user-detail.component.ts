import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AdminService } from '../services/admin.service';
import { AuthService } from '../services/auth.service';
import { ToastService } from '../services/toast.service';
import { AdminUserDetail } from '../models/api.types';

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
      @if (loading()) {
        <wa-spinner style="font-size: 2rem"></wa-spinner>
      } @else if (error()) {
        <wa-callout variant="danger">{{ error() }}</wa-callout>
      } @else if (user(); as u) {
        <wa-card>
          <strong slot="header">{{ u.name || '(no name)' }}</strong>
          <dl>
            <dt>Email</dt>
            <dd>{{ u.email }}</dd>
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

  private readonly id = this.route.snapshot.paramMap.get('id') ?? '';

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly user = signal<AdminUserDetail | null>(null);
  protected readonly removeOpen = signal(false);
  protected readonly deleteOpen = signal(false);
  protected readonly working = signal(false);
  protected readonly sending = signal(false);

  constructor() {
    this.load();
  }

  protected isSelf(): boolean {
    return this.auth.me()?.user.id === this.id;
  }

  protected totalMishnayot(u: AdminUserDetail): number {
    return u.groups.reduce((sum, g) => sum + g.blockSize, 0);
  }

  private load(): void {
    this.loading.set(true);
    this.admin.user(this.id).subscribe({
      next: (u) => {
        this.user.set(u);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load this user.');
        this.loading.set(false);
      },
    });
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
          kind === 'weekly' ? 'Weekly email queued.' : 'Reminder email queued.',
        );
      },
      error: () => {
        this.sending.set(false);
        this.toast.error('Could not queue the email.');
      },
    });
  }

  protected removeAssignments(): void {
    this.working.set(true);
    this.admin.removeAssignments(this.id).subscribe({
      next: () => {
        this.working.set(false);
        this.removeOpen.set(false);
        this.load();
      },
      error: () => this.working.set(false),
    });
  }

  protected deleteUser(): void {
    this.working.set(true);
    this.admin.deleteUser(this.id).subscribe({
      next: () => {
        this.working.set(false);
        this.deleteOpen.set(false);
        this.router.navigate(['/admin/users']);
      },
      error: () => this.working.set(false),
    });
  }
}
