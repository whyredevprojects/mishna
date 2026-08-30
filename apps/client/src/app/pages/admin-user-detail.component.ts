import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  computed,
  inject,
  signal,
  ChangeDetectionStrategy
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
import { AdminEmailPrefsPatch, AdminUserDetail } from '../models/api.types';
import { queryKeys } from '../queries/query-keys';
import { adminUserQueryOptions } from '../queries/queries';

/** The two scheduled emails — both a send-now target and an on/off pref. */
type EmailKind = 'weekly' | 'reminder';

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
      .send-preview {
        margin: 0;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
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
              {{ u.joined ? 'Joined — ' + u.commitment + '/week' : 'Not joined' }}
            </dd>
            <dt>Scheduled emails</dt>
            <dd>
              Weekly {{ u.weeklyEnabled ? 'on' : 'off' }} · reminder
              {{ u.reminderEnabled ? 'on' : 'off' }}
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

        <!--
          What the two send-now buttons below would actually mail, right now. The
          server derives these with the same function the send path uses. Send-now
          deliberately does NOT skip a user who has finished their portion (a silent
          no-op reads as a broken button), so it can legitimately send the empty-state
          email — the admin has to be able to see that before clicking.
        -->
        <p class="muted send-preview">
          Next email contents — Weekly:
          {{ u.weeklyRefCount }}
          {{ u.weeklyRefCount === 1 ? 'mishna' : 'mishnayos' }} · Reminder:
          {{ u.reminderPendingCount }} pending
        </p>
        @if (u.weeklyRefCount === 0 || u.reminderPendingCount === 0) {
          <wa-callout variant="warning">
            <wa-icon slot="icon" name="triangle-exclamation"></wa-icon>
            @if (u.weeklyRefCount === 0 && u.reminderPendingCount === 0) {
              This user has nothing left to learn, so both send buttons would mail an
              empty email ("You have no mishnayos scheduled for this week").
            } @else if (u.weeklyRefCount === 0) {
              "Send weekly email" would mail an empty email — this user has no
              mishnayos left in their portion.
            } @else {
              "Send reminder email" would mail an empty email — this user has already
              learned everything in their current bucket.
            }
          </wa-callout>
        }

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
          <!--
            Turn each *scheduled* email off/on (the user's own email prefs, so they
            see and can undo it in Settings). The send buttons above deliberately
            ignore these flags — they're manual one-offs, not the schedule.
          -->
          @if (u.weeklyEnabled) {
            <wa-button
              variant="warning"
              appearance="outlined"
              [attr.loading]="togglingEmail() === 'weekly' ? '' : null"
              (click)="toggleEmail('weekly', u)"
            >
              <wa-icon slot="start" name="envelope-open"></wa-icon>
              Disable weekly email
            </wa-button>
          } @else {
            <wa-button
              appearance="outlined"
              [attr.loading]="togglingEmail() === 'weekly' ? '' : null"
              (click)="toggleEmail('weekly', u)"
            >
              <wa-icon slot="start" name="envelope"></wa-icon>
              Enable weekly email
            </wa-button>
          }
          @if (u.reminderEnabled) {
            <wa-button
              variant="warning"
              appearance="outlined"
              [attr.loading]="togglingEmail() === 'reminder' ? '' : null"
              (click)="toggleEmail('reminder', u)"
            >
              <wa-icon slot="start" name="bell-slash"></wa-icon>
              Disable reminder emails
            </wa-button>
          } @else {
            <wa-button
              appearance="outlined"
              [attr.loading]="togglingEmail() === 'reminder' ? '' : null"
              (click)="toggleEmail('reminder', u)"
            >
              <wa-icon slot="start" name="bell"></wa-icon>
              Enable reminder emails
            </wa-button>
          }
          @if (!u.emailVerified) {
            <wa-button
              appearance="outlined"
              [attr.disabled]="verifying() ? '' : null"
              (click)="resendVerification()"
            >
              <wa-icon slot="start" name="envelope-circle-check"></wa-icon>
              Resend verification email
            </wa-button>
          }
          <wa-button
            variant="warning"
            appearance="outlined"
            [attr.disabled]="!u.joined ? '' : null"
            (click)="removeOpen.set(true)"
          >
            <wa-icon slot="start" name="eraser"></wa-icon>
            Remove assignments
          </wa-button>
          @if (u.role === 'admin') {
            <wa-button
              variant="warning"
              appearance="outlined"
              (click)="openRole('user')"
            >
              <wa-icon slot="start" name="shield-halved"></wa-icon>
              Revoke admin
            </wa-button>
          } @else {
            <wa-button appearance="outlined" (click)="openRole('admin')">
              <wa-icon slot="start" name="shield-halved"></wa-icon>
              Make admin
            </wa-button>
          }
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
      [attr.label]="
        roleTarget() === 'admin'
          ? 'Make this user an admin?'
          : 'Revoke admin access?'
      "
      [attr.open]="roleOpen() ? '' : null"
      (wa-after-hide)="roleOpen.set(false)"
    >
      @if (roleTarget() === 'admin') {
        Admins can manage all users, groups, and assignments — and can promote or
        remove other admins. Grant this only to people you trust.
      } @else {
        This removes the user's admin access. Their account and assignments are kept.
      }
      <wa-button slot="footer" appearance="plain" (click)="roleOpen.set(false)">
        Cancel
      </wa-button>
      <wa-button
        slot="footer"
        [attr.variant]="roleTarget() === 'admin' ? 'brand' : 'warning'"
        [attr.loading]="working() ? '' : null"
        (click)="setRole()"
      >
        {{ roleTarget() === 'admin' ? 'Make admin' : 'Revoke admin' }}
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
  protected readonly roleOpen = signal(false);
  /** The role the confirm dialog will apply: 'admin' = promote, 'user' = revoke. */
  protected readonly roleTarget = signal<'admin' | 'user'>('admin');
  protected readonly sending = signal(false);
  protected readonly verifying = signal(false);

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

  protected readonly roleMutation = injectMutation(() => ({
    mutationFn: () =>
      firstValueFrom(this.admin.setRole(this.id, this.roleTarget())),
    onSuccess: () => {
      this.roleOpen.set(false);
      this.queryClient.invalidateQueries({
        queryKey: queryKeys.adminUser(this.id),
      });
      this.queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
    },
    onError: (err: HttpErrorResponse) => {
      const detail =
        typeof err.error?.detail === 'string' ? err.error.detail : null;
      this.toast.error(
        detail
          ? `Could not change the role: ${detail}`
          : 'Could not change the role.',
      );
    },
  }));

  /** Which scheduled email the in-flight toggle is for (so only its button spins). */
  protected readonly togglingEmail = signal<EmailKind | null>(null);

  protected readonly emailPrefsMutation = injectMutation(() => ({
    mutationFn: (patch: AdminEmailPrefsPatch) =>
      firstValueFrom(this.admin.setEmailPrefs(this.id, patch)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({
        queryKey: queryKeys.adminUser(this.id),
      });
      this.queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
      this.toast.success('Email settings updated.');
    },
    onError: () => this.toast.error('Could not change the email settings.'),
    onSettled: () => this.togglingEmail.set(null),
  }));

  protected readonly working = computed(
    () =>
      this.removeMutation.isPending() ||
      this.deleteMutation.isPending() ||
      this.roleMutation.isPending() ||
      this.emailPrefsMutation.isPending(),
  );

  protected isSelf(): boolean {
    return this.auth.me()?.user.id === this.id;
  }

  protected totalMishnayot(u: AdminUserDetail): number {
    return u.groups.reduce((sum, g) => sum + g.blockSize, 0);
  }

  protected send(kind: EmailKind): void {
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
        // 409 = the user unsubscribed from the mail itself, so the server refused
        // (see apps/server `sendEmailNow`). Its `detail` is a complete explanation;
        // prefixing it with "Could not send the email" reads like a failure to fix.
        if (err.status === 409 && detail) {
          this.toast.error(detail);
          return;
        }
        this.toast.error(
          detail ? `Could not send the email: ${detail}` : 'Could not send the email.',
        );
      },
    });
  }


  protected resendVerification(): void {
    this.verifying.set(true);
    this.admin.sendVerification(this.id).subscribe({
      next: () => {
        this.verifying.set(false);
        this.toast.success('Verification email sent.');
      },
      error: () => {
        this.verifying.set(false);
        this.toast.error('Could not send the verification email.');
      },
    });
  }

  protected removeAssignments(): void {
    this.removeMutation.mutate();
  }

  protected openRole(role: 'admin' | 'user'): void {
    this.roleTarget.set(role);
    this.roleOpen.set(true);
  }

  protected setRole(): void {
    this.roleMutation.mutate();
  }

  /** Flip one scheduled email; the other flag is omitted, so the server leaves it. */
  protected toggleEmail(kind: EmailKind, u: AdminUserDetail): void {
    this.togglingEmail.set(kind);
    this.emailPrefsMutation.mutate(
      kind === 'weekly'
        ? { weeklyEnabled: !u.weeklyEnabled }
        : { reminderEnabled: !u.reminderEnabled },
    );
  }

  protected deleteUser(): void {
    this.deleteMutation.mutate();
  }
}
