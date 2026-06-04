import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { MishnaRef } from '../models/api.types';
import { formatRef } from '../util/format';
import { MishnaCardComponent } from './mishna-card.component';
import { AssignmentService } from '../services/assignment.service';
import { ToastService } from '../services/toast.service';

const SYNC_ERROR =
  "We weren't able to update your progress. Please try again later.";

/**
 * Today's mishnayot — one {@link MishnaCardComponent} per mishna, with a
 * completion banner when all are learned.
 *
 * This component owns the day's completion state so the cards share one source of
 * truth. The initial state comes from the parent (server-loaded), and each toggle
 * is optimistically applied and synced to apps/server; a failed sync reverts the
 * checkbox and shows an error toast.
 */
@Component({
  selector: 'app-today-card',
  imports: [MishnaCardComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .cards {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-m, 0.75rem);
      }
      .done-banner {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s, 0.5rem);
        color: var(--wa-color-success-on-quiet, #1a7f37);
        font-weight: var(--wa-font-weight-semibold, 600);
        margin-block-start: var(--wa-space-m, 0.75rem);
      }
    `,
  ],
  template: `
    @if (mishnas().length) {
      <div class="cards">
        @for (ref of mishnas(); track key(ref)) {
          <app-mishna-card
            [ref]="ref"
            [done]="isChecked(key(ref))"
            (learned)="toggle(ref)"
          ></app-mishna-card>
        }
      </div>

      @if (allDone()) {
        <div class="done-banner">
          <wa-icon name="circle-check" variant="solid"></wa-icon>
          Done for today!
        </div>
      }
    } @else {
      <p class="muted">No mishnayot assigned today.</p>
    }
  `,
})
export class TodayCardComponent {
  readonly mishnas = input.required<MishnaRef[]>();
  /** ISO date the assignment belongs to. */
  readonly date = input.required<string>();
  /** Completed-mishna keys ({@link formatRef}) for the caller, from the server. */
  readonly completed = input.required<Set<string>>();
  /** The group these mishnayot belong to; null (empty day) disables toggling. */
  readonly groupId = input.required<string | null>();

  protected readonly key = formatRef;

  private readonly assignments = inject(AssignmentService);
  private readonly toast = inject(ToastService);

  private readonly checked = signal<Set<string>>(new Set());

  constructor() {
    // Seed local checks from the server-provided set; re-seeds if it changes.
    // Optimistic toggles mutate the local set only, so they don't trigger this.
    effect(() => {
      this.checked.set(new Set(this.completed()));
    });
  }

  protected isChecked(refKey: string): boolean {
    return this.checked().has(refKey);
  }

  protected readonly allDone = computed(() => {
    const refs = this.mishnas();
    return (
      refs.length > 0 && refs.every((r) => this.checked().has(formatRef(r)))
    );
  });

  /** Optimistically toggle a mishna, syncing to the server and reverting on failure. */
  protected toggle(ref: MishnaRef): void {
    const groupId = this.groupId();
    if (groupId === null) {
      return;
    }
    const refKey = formatRef(ref);
    const before = this.checked();
    const willCheck = !before.has(refKey);

    const next = new Set(before);
    if (willCheck) {
      next.add(refKey);
    } else {
      next.delete(refKey);
    }
    this.checked.set(next);

    const request = willCheck
      ? this.assignments.markLearned(ref, groupId)
      : this.assignments.markUnlearned(ref, groupId);
    request.subscribe({
      error: () => {
        this.checked.set(before);
        this.toast.error(SYNC_ERROR);
      },
    });
  }
}
