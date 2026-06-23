import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  injectMutation,
  injectQuery,
  keepPreviousData,
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
import { addWeeks, formatRef, sundayOnOrBefore } from '../util/format';
import { queryKeys } from '../queries/query-keys';
import {
  assignmentByDateQueryOptions,
  cycleQueryOptions,
  joinOptionsQueryOptions,
  meQueryOptions,
} from '../queries/queries';

/** Logged-in home: this week's mishnayot when joined, otherwise the join card. */
@Component({
  selector: 'app-dashboard',
  imports: [TodayCardComponent, JoinFormComponent, CycleProgressComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .week-nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-s, 0.5rem);
      }
      .week-label {
        flex: 1;
        text-align: center;
        font-size: var(--wa-font-size-m, 1rem);
        font-weight: var(--wa-font-weight-semibold, 600);
        font-variant-numeric: tabular-nums;
      }
      .week-body {
        touch-action: pan-y;
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
          <div class="week-nav">
            <wa-button
              appearance="plain"
              aria-label="Previous week"
              [attr.disabled]="canPrev() ? null : ''"
              (click)="prev()"
            >
              <wa-icon name="chevron-left"></wa-icon>
            </wa-button>
            <span class="week-label muted">{{ weekLabel() }}</span>
            <wa-button
              appearance="plain"
              aria-label="Next week"
              [attr.disabled]="canNext() ? null : ''"
              (click)="next()"
            >
              <wa-icon name="chevron-right"></wa-icon>
            </wa-button>
          </div>
          <div
            class="week-body"
            (touchstart)="onTouchStart($event)"
            (touchend)="onTouchEnd($event)"
          >
            @if (assignment(); as a) {
              <app-today-card
                [mishnas]="a.mishnas"
                [date]="a.date"
                [groupId]="a.groupId"
                [completed]="completed()"
              ></app-today-card>
            }
          </div>
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
  /** The week-start (Sunday, UTC) the user is currently looking at; defaults to today's. */
  protected readonly selectedWeek = signal(sundayOnOrBefore(new Date()));
  private readonly currentWeek = sundayOnOrBefore(new Date());

  // Only fetched once the user is known to have joined. Keyed per week, so each visited
  // week caches separately; `keepPreviousData` keeps the prior week on screen (no spinner
  // flash) while the next one loads.
  private readonly assignmentQuery = injectQuery(() => ({
    ...assignmentByDateQueryOptions(this.assignments, this.selectedWeek()),
    enabled: this.joined(),
    placeholderData: keepPreviousData,
  }));

  protected readonly joinMutation = injectMutation(() => ({
    mutationFn: (commitment: Commitment) =>
      firstValueFrom(this.groups.join(commitment)),
    // Membership changed → re-derive /api/me and today's assignment from the server.
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: queryKeys.me });
      this.queryClient.invalidateQueries({
        queryKey: queryKeys.assignmentRoot,
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

  /** "This week" for the current week, otherwise "Week of June 22, 2026". */
  protected readonly weekLabel = computed(() => {
    const week = this.selectedWeek();
    if (week === this.currentWeek) return 'This week';
    const label = new Date(`${week}T00:00:00.000Z`).toLocaleDateString(
      undefined,
      { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' },
    );
    return `Week of ${label}`;
  });
  // The cycle's first week — the earliest week worth showing.
  private readonly cycleStartWeek = computed(() => {
    const start = this.cycle()?.cycleStart;
    return start ? sundayOnOrBefore(new Date(start)) : null;
  });
  protected readonly canPrev = computed(() => {
    const start = this.cycleStartWeek();
    return !start || this.selectedWeek() > start;
  });
  // A user's portion is finite and empties contiguously once finished, so an empty
  // displayed week is the end of the road forward.
  protected readonly canNext = computed(
    () => (this.assignment()?.mishnas.length ?? 0) > 0,
  );

  protected prev(): void {
    if (this.canPrev()) this.selectedWeek.set(addWeeks(this.selectedWeek(), -1));
  }
  protected next(): void {
    if (this.canNext()) this.selectedWeek.set(addWeeks(this.selectedWeek(), 1));
  }

  private touchStartX: number | null = null;
  protected onTouchStart(e: TouchEvent): void {
    this.touchStartX = e.changedTouches[0]?.clientX ?? null;
  }
  protected onTouchEnd(e: TouchEvent): void {
    if (this.touchStartX === null) return;
    const delta = (e.changedTouches[0]?.clientX ?? this.touchStartX) - this.touchStartX;
    this.touchStartX = null;
    if (Math.abs(delta) < 50) return;
    // Swipe left → forward a week, swipe right → back a week.
    if (delta < 0) this.next();
    else this.prev();
  }

  protected onJoin(commitment: Commitment): void {
    this.joinMutation.mutate(commitment);
  }
}
