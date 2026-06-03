import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  inject,
  signal,
} from '@angular/core';
import { AuthService } from '../services/auth.service';
import { AssignmentService } from '../services/assignment.service';
import { CycleService } from '../services/cycle.service';
import { GroupService } from '../services/group.service';
import { Assignment, Commitment, Cycle } from '../models/api.types';
import { TodayCardComponent } from '../components/today-card.component';
import { JoinFormComponent } from '../components/join-form.component';
import { CycleProgressComponent } from '../components/cycle-progress.component';
import { formatLongDate, formatRef } from '../util/format';

/** Logged-in home: today's mishnayot when joined, otherwise the join card. */
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
      <div class="stack">
        @if (error()) {
          <wa-callout variant="danger">{{ error() }}</wa-callout>
        }

        @if (joined()) {
          <p class="today-date muted">{{ today() }}</p>
          @if (assignment(); as a) {
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

  protected readonly loading = signal(true);
  protected readonly joining = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly joined = signal(false);
  protected readonly assignment = signal<Assignment | null>(null);
  protected readonly completed = signal<Set<string>>(new Set());
  protected readonly cycle = signal<Cycle | null>(null);
  protected readonly today = signal('');

  constructor() {
    this.cycleService.getCycle().subscribe({ next: (c) => this.cycle.set(c) });
    this.refresh();
  }

  private refresh(): void {
    this.loading.set(true);
    this.auth.loadSession().subscribe((me) => {
      const isJoined = me?.joined ?? false;
      this.joined.set(isJoined);
      if (isJoined) {
        this.loadToday();
      } else {
        this.loading.set(false);
      }
    });
  }

  private loadToday(): void {
    this.assignments.today().subscribe({
      next: (a) => {
        this.assignment.set(a);
        this.today.set(formatLongDate(a.date));
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load today’s assignment.');
        this.loading.set(false);
      },
    });
    // Completion state loads in parallel; on failure the card just starts
    // unchecked (toggles still work and sync), so no user-facing error here.
    this.assignments.listCompletions().subscribe({
      next: (c) =>
        this.completed.set(new Set(c.completed.map((r) => formatRef(r)))),
      error: () => this.completed.set(new Set()),
    });
  }

  protected onJoin(commitment: Commitment): void {
    this.joining.set(true);
    this.error.set(null);
    this.groups.join(commitment).subscribe({
      next: () => {
        this.joining.set(false);
        this.refresh();
      },
      error: () => {
        this.joining.set(false);
        this.error.set('Could not join the cycle. Please try again.');
      },
    });
  }
}
