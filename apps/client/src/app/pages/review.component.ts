import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { MishnaRef } from '../models/api.types';
import { AssignmentService } from '../services/assignment.service';
import { MishnaCardComponent } from '../components/mishna-card.component';
import { chalukaQueryOptions } from '../queries/queries';
import { formatRef } from '../util/format';
import { loadReviewSpot, saveReviewSpot } from '../util/review-storage';

/** One mishna of the user's portion, flagged learned-or-not. */
interface MishnaRow {
  ref: MishnaRef;
  done: boolean;
}
/** One perek's worth of the user's portion. */
interface PerekGroup {
  perek: number;
  rows: MishnaRow[];
  done: number;
}
/** One mesechta's worth of the user's portion, in corpus order. */
interface MesechtaGroup {
  mesechta: string;
  perakim: PerekGroup[];
  done: number;
  total: number;
}

/**
 * Review browser over the caller's whole-cycle portion (`GET /api/me/chaluka`):
 * pick a mesechta + perek from your allotment and read the whole perek's text (each
 * mishna with an English toggle), with a sticky mishna selector that scrolls to a
 * mishna and shows which you've already learned. The last spot is remembered in
 * localStorage and restored (and scrolled to) on return.
 */
@Component({
  selector: 'app-review',
  imports: [MishnaCardComponent, RouterLink],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .controls {
        position: sticky;
        top: 0;
        z-index: 1;
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-s, 0.5rem);
        padding-block: var(--wa-space-s, 0.5rem);
        background: var(--wa-color-surface-default, #fff);
        border-block-end: var(--wa-border-width-s, 1px) solid
          var(--wa-color-surface-border, #e5e0d8);
      }
      .selectors {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wa-space-m, 0.75rem);
      }
      .selectors wa-select {
        flex: 1 1 12rem;
      }
      .strip {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wa-space-2xs, 0.25rem);
      }
      .strip wa-button.dim {
        opacity: 0.5;
      }
      .cards {
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
    <div class="stack readable">
      <h2>Review</h2>

      @if (query.isPending()) {
        <div class="spinner-wrap"><wa-spinner style="font-size: 2rem"></wa-spinner></div>
      } @else if (query.isError()) {
        <wa-callout variant="danger">Could not load your portion.</wa-callout>
      } @else if (total() === 0) {
        <wa-callout variant="neutral">
          You haven’t joined the cycle yet.
          <a routerLink="/dashboard">Pick a commitment</a> to get your chaluka.
        </wa-callout>
      } @else if (selected(); as sel) {
        <div class="controls">
          <div class="selectors">
            <wa-select
              label="Mesechta"
              [value]="sel.mesechta"
              (change)="onMesechta($event)"
            >
              @for (m of mesechtaGroups(); track m.mesechta) {
                <wa-option [value]="m.mesechta"
                  >{{ m.mesechta }} ({{ m.done }}/{{ m.total }})</wa-option
                >
              }
            </wa-select>

            <wa-select
              label="Perek"
              [value]="sel.perek.toString()"
              (change)="onPerek($event)"
            >
              @for (p of perakim(); track p.perek) {
                <wa-option [value]="p.perek.toString()"
                  >Perek {{ p.perek }} ({{ p.done }}/{{ p.rows.length }})</wa-option
                >
              }
            </wa-select>
          </div>

          <div class="strip">
            @for (row of rows(); track row.ref.mishna) {
              <wa-button
                size="small"
                [attr.appearance]="row.ref.mishna === sel.mishna ? 'accent' : (row.done ? 'filled' : 'outlined')"
                [attr.variant]="row.done ? 'success' : 'neutral'"
                [class.dim]="!row.done && row.ref.mishna !== sel.mishna"
                (click)="goToMishna(row.ref)"
              >{{ row.ref.mishna }}</wa-button>
            }
          </div>
        </div>

        <div class="cards">
          @for (row of rows(); track row.ref.mishna) {
            <div [id]="anchorId(row.ref.mishna)">
              <app-mishna-card
                [ref]="row.ref"
                [done]="row.done"
                [showCheckbox]="false"
              ></app-mishna-card>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class ReviewComponent {
  private readonly assignments = inject(AssignmentService);

  protected readonly query = injectQuery(() =>
    chalukaQueryOptions(this.assignments),
  );

  /** The current spot: drives which mesechta/perek is shown, the saved place, and
   * the strip's active mishna / scroll target. */
  protected readonly selected = signal<MishnaRef | null>(null);

  protected readonly total = computed(
    () => this.query.data()?.assigned.length ?? 0,
  );

  /** The whole portion grouped mesechta → perek → mishna, in corpus order. */
  protected readonly mesechtaGroups = computed<MesechtaGroup[]>(() => {
    const data = this.query.data();
    if (!data) {
      return [];
    }
    const done = new Set(data.completed.map(formatRef));
    // Built in corpus order (assigned is corpus-ordered); objects are pushed once and
    // then mutated in place, so the arrays keep first-seen order without lookups.
    const groups: MesechtaGroup[] = [];
    const byMesechta = new Map<string, MesechtaGroup>();
    const byPerek = new Map<string, PerekGroup>();
    for (const ref of data.assigned) {
      let m = byMesechta.get(ref.mesechta);
      if (!m) {
        m = { mesechta: ref.mesechta, perakim: [], done: 0, total: 0 };
        byMesechta.set(ref.mesechta, m);
        groups.push(m);
      }
      const perekKey = `${ref.mesechta} ${ref.perek}`;
      let p = byPerek.get(perekKey);
      if (!p) {
        p = { perek: ref.perek, rows: [], done: 0 };
        byPerek.set(perekKey, p);
        m.perakim.push(p);
      }
      const isDone = done.has(formatRef(ref));
      p.rows.push({ ref, done: isDone });
      m.total++;
      if (isDone) {
        p.done++;
        m.done++;
      }
    }
    return groups;
  });

  private readonly currentMesechtaGroup = computed(() => {
    const sel = this.selected();
    return sel
      ? this.mesechtaGroups().find((m) => m.mesechta === sel.mesechta)
      : undefined;
  });
  protected readonly perakim = computed(
    () => this.currentMesechtaGroup()?.perakim ?? [],
  );
  private readonly currentPerekGroup = computed(() => {
    const sel = this.selected();
    return sel ? this.perakim().find((p) => p.perek === sel.perek) : undefined;
  });
  /** The mishnayos of the current perek — all rendered as cards. */
  protected readonly rows = computed(() => this.currentPerekGroup()?.rows ?? []);

  private readonly assignedKeys = computed(
    () => new Set((this.query.data()?.assigned ?? []).map(formatRef)),
  );
  private initialized = false;

  constructor() {
    // Once the portion loads, restore the saved spot (if still in the portion) or
    // start at the first mishna; then scroll to it. Guarded so a later refetch
    // doesn't reset the view.
    effect(() => {
      const groups = this.mesechtaGroups();
      if (this.initialized || groups.length === 0) {
        return;
      }
      this.initialized = true;
      const saved = loadReviewSpot();
      const start =
        saved && this.assignedKeys().has(formatRef(saved))
          ? saved
          : groups[0].perakim[0].rows[0].ref;
      this.selected.set(start);
      this.scheduleScroll(start.mishna);
    });

    // Remember the current spot so /review returns here next time.
    effect(() => {
      const sel = this.selected();
      if (sel) {
        saveReviewSpot(sel);
      }
    });
  }

  protected anchorId(mishna: number): string {
    return `review-mishna-${mishna}`;
  }

  protected goToMishna(ref: MishnaRef): void {
    this.selected.set(ref);
    this.scheduleScroll(ref.mishna);
  }

  protected onMesechta(event: Event): void {
    const name = (event.target as HTMLSelectElement).value;
    const group = this.mesechtaGroups().find((m) => m.mesechta === name);
    if (group) {
      this.goToMishna(group.perakim[0].rows[0].ref);
    }
  }

  protected onPerek(event: Event): void {
    const perek = Number((event.target as HTMLSelectElement).value);
    const group = this.perakim().find((p) => p.perek === perek);
    if (group) {
      this.goToMishna(group.rows[0].ref);
    }
  }

  /** Scroll a mishna's card into view once the perek's cards have rendered. */
  private scheduleScroll(mishna: number): void {
    const scroll = () => {
      document
        .getElementById(this.anchorId(mishna))
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(scroll);
    } else {
      scroll();
    }
  }
}
