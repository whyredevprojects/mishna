import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { AssignmentService } from '../services/assignment.service';
import { chalukaQueryOptions } from '../queries/queries';
import { formatRef, formatLongDate } from '../util/format';

/** One mesechta's slice of the user's portion. */
interface MesechtaProgress {
  mesechta: string;
  total: number;
  done: number;
}

/**
 * "My Chaluka": a higher-level view of the user's whole-cycle commitment — overall
 * learned/total progress, a few stats, and a per-mesechta breakdown of their portion.
 */
@Component({
  selector: 'app-chaluka',
  imports: [RouterLink],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .headline {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: var(--wa-space-s, 0.5rem);
      }
      .headline .count {
        font-size: var(--wa-font-size-xl, 1.5rem);
        font-weight: var(--wa-font-weight-bold, 700);
        font-variant-numeric: tabular-nums;
      }
      .pct {
        font-variant-numeric: tabular-nums;
        color: var(--wa-color-text-quiet, #6b6358);
      }
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
        text-align: end;
        font-variant-numeric: tabular-nums;
      }
      .row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: var(--wa-space-s, 0.5rem);
        font-size: var(--wa-font-size-s, 0.875rem);
      }
      .row .frac {
        color: var(--wa-color-text-quiet, #6b6358);
        font-variant-numeric: tabular-nums;
      }
      .breakdown {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-m, 0.75rem);
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
      <h2>My Chaluka</h2>

      @if (query.isPending()) {
        <div class="spinner-wrap"><wa-spinner style="font-size: 2rem"></wa-spinner></div>
      } @else if (query.isError()) {
        <wa-callout variant="danger">Could not load your chaluka.</wa-callout>
      } @else if (total() === 0) {
        <wa-callout variant="neutral">
          You haven’t joined the cycle yet.
          <a routerLink="/dashboard">Pick a commitment</a> to get your chaluka.
        </wa-callout>
      } @else {
        <wa-card>
          <strong slot="header">Overall progress</strong>
          <div class="stack">
            <div class="headline">
              <span class="count">{{ learned() }} / {{ total() }}</span>
              <span class="pct">{{ pct() }}% complete</span>
            </div>
            <wa-progress-bar [value]="pct()"></wa-progress-bar>
            <span class="muted">mishnayos learned</span>
          </div>
        </wa-card>

        <wa-card>
          <strong slot="header">Stats</strong>
          <dl>
            <dt>Weekly goal</dt>
            <dd>{{ commitment() }} / week</dd>
            <dt>Completion rate</dt>
            <dd>{{ pct() }}%</dd>
            <dt>Member since</dt>
            <dd>{{ memberSince() }}</dd>
          </dl>
        </wa-card>

        <wa-card>
          <strong slot="header">By mesechta</strong>
          <div class="breakdown">
            @for (m of breakdown(); track m.mesechta) {
              <div>
                <div class="row">
                  <strong>{{ m.mesechta }}</strong>
                  <span class="frac">{{ m.done }} / {{ m.total }}</span>
                </div>
                <wa-progress-bar [value]="rowPct(m)"></wa-progress-bar>
              </div>
            }
          </div>
        </wa-card>
      }
    </div>
  `,
})
export class ChalukaComponent {
  private readonly assignments = inject(AssignmentService);

  protected readonly query = injectQuery(() =>
    chalukaQueryOptions(this.assignments),
  );

  protected readonly total = computed(
    () => this.query.data()?.assigned.length ?? 0,
  );
  protected readonly learned = computed(
    () => this.query.data()?.completed.length ?? 0,
  );
  protected readonly pct = computed(() => {
    const total = this.total();
    return total > 0 ? Math.round((this.learned() / total) * 100) : 0;
  });
  protected readonly commitment = computed(
    () => this.query.data()?.commitment ?? 0,
  );
  protected readonly memberSince = computed(() => {
    const joinedAt = this.query.data()?.joinedAt;
    return joinedAt ? formatLongDate(joinedAt) : '—';
  });

  /** The portion grouped by mesechta, in corpus order, with learned counts. */
  protected readonly breakdown = computed<MesechtaProgress[]>(() => {
    const data = this.query.data();
    if (!data) {
      return [];
    }
    const done = new Set(data.completed.map((r) => formatRef(r)));
    const byMesechta = new Map<string, MesechtaProgress>();
    for (const ref of data.assigned) {
      let entry = byMesechta.get(ref.mesechta);
      if (!entry) {
        entry = { mesechta: ref.mesechta, total: 0, done: 0 };
        byMesechta.set(ref.mesechta, entry);
      }
      entry.total++;
      if (done.has(formatRef(ref))) {
        entry.done++;
      }
    }
    return [...byMesechta.values()];
  });

  protected rowPct(m: MesechtaProgress): number {
    return m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;
  }
}
