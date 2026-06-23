import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  computed,
  inject,
} from '@angular/core';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { AssignmentService } from '../services/assignment.service';
import { CycleService } from '../services/cycle.service';
import { GroupService } from '../services/group.service';
import { Commitment } from '../models/api.types';
import { TodayCardComponent } from '../components/today-card.component';
import { JoinFormComponent } from '../components/join-form.component';
import { CycleProgressComponent } from '../components/cycle-progress.component';
import { formatRef } from '../util/format';
import { queryKeys } from '../queries/query-keys';
import {
  cycleQueryOptions,
  joinOptionsQueryOptions,
  meQueryOptions,
  todayAssignmentQueryOptions,
} from '../queries/queries';

/** Logged-in home: the user's current mishnayot when joined, otherwise the join card. */
@Component({
  selector: 'app-dashboard',
  imports: [TodayCardComponent, JoinFormComponent, CycleProgressComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .today-date {
        font-size: var(--wa-font-size-m, 1rem);
      }
      .spinner-wrap {
        display: flex;
        justify-content: center;
        padding: var(--wa-space-2xl, 2rem);
      }
    `,
  ],
  template: `
    @if (loading()) {
      <div class="spinner-wrap"><wa-spinner style="font-size: 2rem"></wa-spinner></div>
    } @else {
      <div class="stack readable">
        @if (error()) {
          <wa-callout variant="danger">{{ error() }}</wa-callout>
        }

        @if (joined()) {
          @if (assignment(); as a) {
            @if (a.mishnas.length) {
              <p class="today-date muted">Your next mishnayos</p>
            }
            <app-today-card
              [mishnas]="a.mishnas"
              [date]="a.date"
              [groupId]="a.groupId"
              [completed]="completed()"
            ></app-today-card>
          }
          @if (cycle(); as c) {
            <wa-divider></wa-divider>
            <app-cycle-progress [cycle]="c"></app-cycle-progress>
          }
        } @else {
          <app-join-form
            [loading]="joining()"
            [options]="joinOptions()"
            (join)="onJoin($event)"
          ></app-join-form>
          @if (cycle(); as c) {
            <app-cycle-progress [cycle]="c"></app-cycle-progress>
          }
        }
      </div>
    }
  `,
})
export class DashboardComponent {
  private readonly auth = inject(AuthService);
  private readonly assignments = inject(AssignmentService);
  private readonly cycleService = inject(CycleService);
  private readonly groups = inject(GroupService);
  private readonly queryClient = inject(QueryClient);

  private readonly meQuery = injectQuery(() => meQueryOptions(this.auth));
  protected readonly cycleQuery = injectQuery(() =>
    cycleQueryOptions(this.cycleService),
  );
  protected readonly joined = computed(
    () => this.meQuery.data()?.joined ?? false,
  );
  // The signup options (lot estimates per pace); only needed before joining.
  private readonly joinOptionsQuery = injectQuery(() => ({
    ...joinOptionsQueryOptions(this.groups),
    enabled: !this.joined(),
  }));
  // Only fetched once the user is known to have joined.
  private readonly assignmentQuery = injectQuery(() => ({
    ...todayAssignmentQueryOptions(this.assignments),
    enabled: this.joined(),
  }));

  protected readonly joinMutation = injectMutation(() => ({
    mutationFn: (commitment: Commitment) =>
      firstValueFrom(this.groups.join(commitment)),
    // Membership changed → re-derive /api/me and today's assignment from the server.
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: queryKeys.me });
      this.queryClient.invalidateQueries({
        queryKey: queryKeys.assignmentToday,
      });
      this.queryClient.invalidateQueries({ queryKey: queryKeys.chaluka });
    },
  }));

  // `me` is typically already cached by the route guard, so the dashboard renders
  // without a spinner; only the (joined-only) assignment fetch can still be loading.
  protected readonly loading = computed(
    () =>
      this.meQuery.isLoading() ||
      (this.joined() && this.assignmentQuery.isLoading()),
  );
  protected readonly error = computed(() => {
    if (this.assignmentQuery.isError()) {
      return 'Could not load this week’s assignment.';
    }
    if (this.joinMutation.isError()) {
      return 'Could not join the cycle. Please try again.';
    }
    return null;
  });
  protected readonly joining = computed(() => this.joinMutation.isPending());

  protected readonly assignment = computed(() => this.assignmentQuery.data());
  protected readonly cycle = computed(() => this.cycleQuery.data());
  protected readonly joinOptions = computed(
    () => this.joinOptionsQuery.data()?.options,
  );
  // The assignment carries its own completion state, so the checks render from the
  // same response (no separate, separately-failing fetch).
  protected readonly completed = computed(
    () => new Set((this.assignment()?.completed ?? []).map((r) => formatRef(r))),
  );

  protected onJoin(commitment: Commitment): void {
    this.joinMutation.mutate(commitment);
  }
}
