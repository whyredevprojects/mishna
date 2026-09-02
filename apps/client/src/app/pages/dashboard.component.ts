import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  computed,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  injectMutation,
  injectQuery,
  keepPreviousData,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { ActivatedRoute, Router } from '@angular/router';
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
import { IS_HEBREW } from '../util/locale';
import { queryKeys } from '../queries/query-keys';
import {
  cycleQueryOptions,
  joinOptionsQueryOptions,
  meQueryOptions,
} from '../queries/queries';

/** Logged-in home: the user's current mishnayot when joined, otherwise the join card. */
@Component({
  selector: 'app-dashboard',
  imports: [TodayCardComponent, JoinFormComponent, CycleProgressComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .pager-nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-s, 0.5rem);
      }
      .pager-label {
        flex: 1;
        text-align: center;
        font-size: var(--wa-font-size-m, 1rem);
        font-weight: var(--wa-font-weight-semibold, 600);
      }
      .pager-body {
        touch-action: pan-y;
      }
      .memorized-notice {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s, 0.5rem);
      }
      .memorized-notice span {
        flex: 1;
      }
      .spinner-wrap {
        display: flex;
        justify-content: center;
        padding: var(--wa-space-2xl, 2rem);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <!--
      Outside the loading gate on purpose: this is the landing spot for the emailed
      "I've memorized this" link, and someone who just clicked it should see the
      confirmation immediately rather than behind a spinner waiting on queries that
      have nothing to do with it.
    -->
    @if (showMemorized()) {
      <div class="readable">
        <wa-callout variant="success" class="memorized-notice">
          <wa-icon slot="icon" name="circle-check"></wa-icon>
          <span i18n="@@dashboard.memorizedNotice"
            >We've marked those mishnayos as learned.</span
          >
          <wa-button
            appearance="plain"
            aria-label="Dismiss"
            i18n-aria-label="@@dashboard.dismissNotice"
            (click)="dismissMemorized()"
          >
            <wa-icon name="xmark"></wa-icon>
          </wa-button>
        </wa-callout>
      </div>
    }
    @if (loading()) {
      <div class="spinner-wrap">
        <wa-spinner style="font-size: 2rem"></wa-spinner>
      </div>
    } @else {
      <div class="stack readable">
        @if (error()) {
          <wa-callout variant="danger">{{ error() }}</wa-callout>
        }

        @if (joined()) {
          <div class="pager-nav">
            <wa-button
              appearance="plain"
              aria-label="Previous mishnayos"
              i18n-aria-label="@@dashboard.prevMishnayos"
              [attr.disabled]="canPrev() ? null : ''"
              (click)="prev()"
            >
              <wa-icon name="chevron-left" class="dir-flip"></wa-icon>
            </wa-button>
            <span class="pager-label muted">{{ pagerLabel() }}</span>
            <wa-button
              appearance="plain"
              aria-label="Next mishnayos"
              i18n-aria-label="@@dashboard.nextMishnayos"
              [attr.disabled]="canNext() ? null : ''"
              (click)="next()"
            >
              <wa-icon name="chevron-right" class="dir-flip"></wa-icon>
            </wa-button>
          </div>
          <div
            class="pager-body"
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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /**
   * The one-time "marked as memorized" notice, shown after the emailed CTA lands here
   * with `?memorized=1`.
   *
   * The param is stripped immediately (`replaceUrl`, so it leaves no history entry):
   * without that, a refresh or a back-navigation would replay a notice about something
   * that happened once, days ago. The signal — not the URL — is what the template
   * reads, so dismissing it is instant and doesn't touch routing.
   */
  protected readonly showMemorized = signal(
    this.route.snapshot.queryParamMap.get('memorized') === '1',
  );

  constructor() {
    if (this.showMemorized()) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { memorized: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }

  protected dismissMemorized(): void {
    this.showMemorized.set(false);
  }

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
  // The bucket the pager is showing; `null` means "the current (next-unlearned)
  // bucket", which the server resolves and reports back as `bucket`. prev/next set
  // an explicit index relative to whatever the response says it served.
  protected readonly bucket = signal<number | null>(null);

  // Only fetched once the user is known to have joined. `null` → the current
  // bucket (`/today`); a number → that explicit bucket. Keyed per bucket so each
  // caches separately; `keepPreviousData` keeps the prior one on screen (no
  // spinner flash) while the next loads.
  private readonly assignmentQuery = injectQuery(() => {
    const b = this.bucket();
    return {
      queryKey:
        b === null ? queryKeys.assignmentToday : queryKeys.assignmentBucket(b),
      queryFn: () =>
        firstValueFrom(
          b === null ? this.assignments.today() : this.assignments.atBucket(b),
        ),
      enabled: this.joined(),
      placeholderData: keepPreviousData,
    };
  });

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
      return $localize`Could not load this week’s assignment.`;
    }
    if (this.joinMutation.isError()) {
      return $localize`Could not join the cycle. Please try again.`;
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
    () =>
      new Set((this.assignment()?.completed ?? []).map((r) => formatRef(r))),
  );

  // The bucket index the server actually served (after clamping), and the bounds
  // derived from the response — so prev/next always step from the real position.
  private readonly served = computed(() => this.assignment()?.bucket ?? 0);
  private readonly bucketCount = computed(
    () => this.assignment()?.bucketCount ?? 0,
  );
  private readonly currentBucket = computed(
    () => this.assignment()?.currentBucket ?? 0,
  );

  /** A label for where the shown bucket sits relative to the current one. */
  protected readonly pagerLabel = computed(() => {
    const at = this.served();
    const current = this.currentBucket();
    if (at < current) return $localize`Already learned`;
    if (at > current) return $localize`Coming up`;
    return $localize`Current mishnayos`;
  });
  protected readonly canPrev = computed(() => this.served() > 0);
  // A user's portion is finite; the last bucket is the end of the road forward.
  protected readonly canNext = computed(
    () => this.served() < this.bucketCount() - 1,
  );

  protected prev(): void {
    if (this.canPrev()) this.bucket.set(this.served() - 1);
  }
  protected next(): void {
    if (this.canNext()) this.bucket.set(this.served() + 1);
  }

  private touchStartX: number | null = null;
  protected onTouchStart(e: TouchEvent): void {
    this.touchStartX = e.changedTouches[0]?.clientX ?? null;
  }
  protected onTouchEnd(e: TouchEvent): void {
    if (this.touchStartX === null) return;
    const delta =
      (e.changedTouches[0]?.clientX ?? this.touchStartX) - this.touchStartX;
    this.touchStartX = null;
    if (Math.abs(delta) < 50) return;
    // Swipe against the reading direction advances; mirrored in RTL. In LTR a
    // leftward swipe (delta < 0) goes forward; in RTL a rightward swipe does.
    const forward = IS_HEBREW ? delta > 0 : delta < 0;
    if (forward) this.next();
    else this.prev();
  }

  protected onJoin(commitment: Commitment): void {
    this.joinMutation.mutate(commitment);
  }
}
