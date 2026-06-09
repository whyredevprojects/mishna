import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { MishnaRef } from '../models/api.types';
import { AssignmentService } from '../services/assignment.service';
import { MishnaCardComponent } from '../components/mishna-card.component';
import { chalukaQueryOptions } from '../queries/queries';
import { formatRef } from '../util/format';

/** One mesechta's mishnayot from the user's portion, each flagged learned-or-not. */
interface MesechtaGroup {
  mesechta: string;
  done: number;
  rows: { ref: MishnaRef; done: boolean }[];
}

/**
 * "My Mishnayos" → Assignments tab: the user's whole-cycle portion as an extensive
 * mishna-by-mishna list, grouped by mesechta, each row showing learned/pending
 * status. Read-only — check-off lives on the "Today" view (which carries the
 * groupId each completion needs).
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
                  [showCheckbox]="false"
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

  protected readonly key = formatRef;

  protected readonly query = injectQuery(() =>
    chalukaQueryOptions(this.assignments),
  );

  protected readonly total = computed(
    () => this.query.data()?.assigned.length ?? 0,
  );

  /** The portion grouped by mesechta, in corpus order, with per-mishna status. */
  protected readonly groups = computed<MesechtaGroup[]>(() => {
    const data = this.query.data();
    if (!data) {
      return [];
    }
    const done = new Set(data.completed.map((r) => formatRef(r)));
    const byMesechta = new Map<string, MesechtaGroup>();
    for (const ref of data.assigned) {
      let group = byMesechta.get(ref.mesechta);
      if (!group) {
        group = { mesechta: ref.mesechta, done: 0, rows: [] };
        byMesechta.set(ref.mesechta, group);
      }
      const isDone = done.has(formatRef(ref));
      group.rows.push({ ref, done: isDone });
      if (isDone) {
        group.done++;
      }
    }
    return [...byMesechta.values()];
  });
}
