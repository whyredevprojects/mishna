import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  computed,
  effect,
  inject,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';
import { MishnaRef } from '../models/api.types';
import { AssignmentService } from '../services/assignment.service';
import { ToastService } from '../services/toast.service';
import { MishnaCardComponent } from '../components/mishna-card.component';
import { chalukaQueryOptions } from '../queries/queries';
import { queryKeys } from '../queries/query-keys';
import { formatRef } from '../util/format';

const SYNC_ERROR =
  "We weren't able to update your progress. Please try again later.";

/** One row in the list: a mishna, its learned status, and the group it belongs to. */
interface AssignmentRow {
  ref: MishnaRef;
  done: boolean;
  /** The group a completion for this mishna is recorded under. */
  groupId: string;
}

/** One mesechta's mishnayot from the user's portion, each flagged learned-or-not. */
interface MesechtaGroup {
  mesechta: string;
  done: number;
  rows: AssignmentRow[];
}

/**
 * "My Mishnayos" → Assignments tab: the user's whole-cycle portion as an extensive
 * mishna-by-mishna list, grouped by mesechta, each row a checkbox to mark that
 * mishna learned/not-learned. Each toggle is optimistically applied and synced to
 * apps/server (with the group the mishna belongs to); a failed sync reverts and
 * shows an error toast — the same pattern the "Today" view uses.
 */
@Component({
  selector: 'app-my-mishnayos-assignments',
  imports: [RouterLink, MishnaCardComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .card-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: var(--wa-space-s, 0.5rem);
      }
      .card-head .frac {
        color: var(--wa-color-text-quiet, #6b6358);
        font-variant-numeric: tabular-nums;
        font-weight: var(--wa-font-weight-normal, 400);
      }
      .rows {
        display: flex;
        flex-direction: column;
      }
      app-mishna-card + app-mishna-card {
        border-block-start: var(--wa-border-width-s, 1px) solid
          var(--wa-color-surface-border, #e5e0d8);
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
    <div class="stack">
      @if (query.isPending()) {
        <div class="spinner-wrap"><wa-spinner style="font-size: 2rem"></wa-spinner></div>
      } @else if (query.isError()) {
        <wa-callout variant="danger">Could not load your assignments.</wa-callout>
      } @else if (total() === 0) {
        <wa-callout variant="neutral">
          You haven’t joined the cycle yet.
          <a routerLink="/dashboard">Pick a commitment</a> to get your chaluka.
        </wa-callout>
      } @else {
        @for (g of groups(); track g.mesechta) {
          <wa-card>
            <div slot="header" class="card-head">
              <strong>{{ g.mesechta }}</strong>
              <span class="frac">{{ g.done }} / {{ g.rows.length }}</span>
            </div>
            <div class="rows">
              @for (row of g.rows; track key(row.ref)) {
                <app-mishna-card
                  [ref]="row.ref"
                  [done]="row.done"
                  [collapsible]="true"
                  [showCheckbox]="true"
                  (learned)="toggle(row)"
                ></app-mishna-card>
              }
            </div>
          </wa-card>
        }
      }
    </div>
  `,
})
export class MyMishnayosAssignmentsComponent {
  private readonly assignments = inject(AssignmentService);
  private readonly toast = inject(ToastService);
  private readonly queryClient = inject(QueryClient);

  protected readonly key = formatRef;

  protected readonly query = injectQuery(() =>
    chalukaQueryOptions(this.assignments),
  );

  protected readonly total = computed(
    () => this.query.data()?.assigned.length ?? 0,
  );

  /** Learned-mishna keys ({@link formatRef}), seeded from the server then toggled
   *  optimistically (so the checkbox and the per-mesechta fraction update at once). */
  private readonly checked = signal<Set<string>>(new Set());

  // Syncs a single toggle to the server: optimistic in `onMutate`, rolls back in
  // `onError`, and `onSettled` refreshes the cached portion (and the dashboard's
  // "Today" view, which derives its completion state from the same completions).
  private readonly toggleMutation = injectMutation<
    unknown,
    Error,
    { ref: MishnaRef; groupId: string; learn: boolean },
    { before: Set<string> }
  >(() => ({
    mutationFn: (vars) =>
      firstValueFrom(
        vars.learn
          ? this.assignments.markLearned(vars.ref, vars.groupId)
          : this.assignments.markUnlearned(vars.ref, vars.groupId),
      ),
    onMutate: (vars) => {
      const before = this.checked();
      const refKey = formatRef(vars.ref);
      const next = new Set(before);
      if (vars.learn) {
        next.add(refKey);
      } else {
        next.delete(refKey);
      }
      this.checked.set(next);
      return { before };
    },
    onError: (_err, _vars, context) => {
      if (context) {
        this.checked.set(context.before);
      }
      this.toast.error(SYNC_ERROR);
    },
    onSettled: () => {
      this.queryClient.invalidateQueries({ queryKey: queryKeys.chaluka });
      this.queryClient.invalidateQueries({
        queryKey: queryKeys.assignmentToday,
      });
    },
  }));

  constructor() {
    // Seed local checks from the server portion; re-seeds when it refetches.
    // Optimistic toggles mutate the local set only, so they don't trigger this.
    effect(() => {
      const data = this.query.data();
      this.checked.set(new Set(data?.completed.map((r) => formatRef(r)) ?? []));
    });
  }

  /** The portion grouped by mesechta, in corpus order, with per-mishna status. */
  protected readonly groups = computed<MesechtaGroup[]>(() => {
    const data = this.query.data();
    if (!data) {
      return [];
    }
    const done = this.checked();
    const byMesechta = new Map<string, MesechtaGroup>();
    data.assigned.forEach((ref, i) => {
      let group = byMesechta.get(ref.mesechta);
      if (!group) {
        group = { mesechta: ref.mesechta, done: 0, rows: [] };
        byMesechta.set(ref.mesechta, group);
      }
      const isDone = done.has(formatRef(ref));
      group.rows.push({ ref, done: isDone, groupId: data.groupIds[i] });
      if (isDone) {
        group.done++;
      }
    });
    return [...byMesechta.values()];
  });

  /** Optimistically toggle a mishna, syncing to the server and reverting on failure. */
  protected toggle(row: AssignmentRow): void {
    if (!row.groupId) {
      return;
    }
    const learn = !this.checked().has(formatRef(row.ref));
    this.toggleMutation.mutate({ ref: row.ref, groupId: row.groupId, learn });
  }
}
