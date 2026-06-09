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
 * pick a mesechta + perek from your allotment, read each mishna's text (with an
 * English toggle), see which you've already learned, and page through the perek.
 * The last spot is remembered in localStorage and restored on return.
 */
@Component({
  selector: 'app-review',
  imports: [MishnaCardComponent, RouterLink],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
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
      .nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-s, 0.5rem);
      }
      .nav .count {
        font-variant-numeric: tabular-nums;
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
      } @else if (selected(); as ref) {
        <div class="selectors">
          <wa-select
            label="Mesechta"
            [value]="mesechtaValue()"
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
            [value]="perekValue()"
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
          @for (row of rows(); track row.ref.mishna; let i = $index) {
            <wa-button
              size="small"
              [attr.appearance]="i === currentIndex() ? 'accent' : (row.done ? 'filled' : 'outlined')"
              [attr.variant]="row.done ? 'success' : 'neutral'"
              [class.dim]="!row.done && i !== currentIndex()"
              (click)="select(row.ref)"
            >{{ row.ref.mishna }}</wa-button>
          }
        </div>

        <div class="nav">
          <wa-button
            appearance="outlined"
            [attr.disabled]="hasPrev() ? null : ''"
            (click)="prev()"
          >
            <wa-icon slot="start" name="chevron-left"></wa-icon>
            Previous
          </wa-button>
          <span class="muted count">{{ position() }} of {{ rows().length }}</span>
          <wa-button
            appearance="outlined"
            [attr.disabled]="hasNext() ? null : ''"
            (click)="next()"
          >
            Next
            <wa-icon slot="end" name="chevron-right"></wa-icon>
          </wa-button>
        </div>

        <app-mishna-card
          [ref]="ref"
          [done]="currentDone()"
          [showCheckbox]="false"
          [resetEnglishOnChange]="false"
        ></app-mishna-card>
      }
    </div>
  `,
})
export class ReviewComponent {
  private readonly assignments = inject(AssignmentService);

  protected readonly query = injectQuery(() =>
    chalukaQueryOptions(this.assignments),
  );

  /** The mishna currently being reviewed; everything else derives from it. */
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
  /** The mishnayos of the current perek (within-perek next/prev step over these). */
  protected readonly rows = computed(() => this.currentPerekGroup()?.rows ?? []);

  protected readonly currentIndex = computed(() => {
    const sel = this.selected();
    return sel ? this.rows().findIndex((r) => r.ref.mishna === sel.mishna) : -1;
  });
  protected readonly currentDone = computed(
    () => this.rows()[this.currentIndex()]?.done ?? false,
  );
  protected readonly position = computed(() => this.currentIndex() + 1);
  protected readonly hasPrev = computed(() => this.currentIndex() > 0);
  protected readonly hasNext = computed(
    () => this.currentIndex() < this.rows().length - 1,
  );

  protected readonly mesechtaValue = computed(
    () => this.selected()?.mesechta ?? '',
  );
  protected readonly perekValue = computed(() => {
    const perek = this.selected()?.perek;
    return perek == null ? '' : perek.toString();
  });

  private readonly assignedKeys = computed(
    () => new Set((this.query.data()?.assigned ?? []).map(formatRef)),
  );
  private initialized = false;

  constructor() {
    // Once the portion loads, restore the saved spot (if still in the portion) or
    // start at the first mishna. Guarded so a later refetch doesn't reset the view.
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
    });

    // Remember the current spot so /review returns here next time.
    effect(() => {
      const sel = this.selected();
      if (sel) {
        saveReviewSpot(sel);
      }
    });
  }

  protected select(ref: MishnaRef): void {
    this.selected.set(ref);
  }

  protected onMesechta(event: Event): void {
    const name = (event.target as HTMLSelectElement).value;
    const group = this.mesechtaGroups().find((m) => m.mesechta === name);
    if (group) {
      this.selected.set(group.perakim[0].rows[0].ref);
    }
  }

  protected onPerek(event: Event): void {
    const perek = Number((event.target as HTMLSelectElement).value);
    const group = this.perakim().find((p) => p.perek === perek);
    if (group) {
      this.selected.set(group.rows[0].ref);
    }
  }

  protected prev(): void {
    const i = this.currentIndex();
    if (i > 0) {
      this.selected.set(this.rows()[i - 1].ref);
    }
  }

  protected next(): void {
    const rows = this.rows();
    const i = this.currentIndex();
    if (i < rows.length - 1) {
      this.selected.set(rows[i + 1].ref);
    }
  }
}
