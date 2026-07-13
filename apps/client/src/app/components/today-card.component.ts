import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';
import {
  injectMutation,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';
import { MishnaRef } from '../models/api.types';
import { formatRef } from '../util/format';
import { MishnaCardComponent } from './mishna-card.component';
import { AssignmentService } from '../services/assignment.service';
import { ToastService } from '../services/toast.service';
import { queryKeys } from '../queries/query-keys';

const SYNC_ERROR =
  "We weren't able to update your progress. Please try again later.";

/**
 * The user's current mishnayot — one {@link MishnaCardComponent} per mishna, with a
 * completion banner when all are learned, or a "finished" banner once their whole
 * portion is done (an empty assignment).
 *
 * This component owns the week's completion state so the cards share one source of
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
  changeDetection: ChangeDetectionStrategy.Eager,
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
          Learned these mishnayos!
        </div>
      }
    } @else {
      <div class="done-banner">
        <wa-icon name="circle-check" variant="solid"></wa-icon>
        You’ve finished all your mishnayos!
      </div>
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
  private readonly queryClient = inject(QueryClient);

  private readonly checked = signal<Set<string>>(new Set());

  // Syncs a single toggle to the server. Optimistic update happens in `onMutate`,
  // rolls back in `onError`, and `onSettled` refreshes the cached assignment so its
  // completion state stays authoritative (and survives navigation).
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
      // Prefix-match so whichever week is on screen (today or a per-date page) refreshes.
      this.queryClient.invalidateQueries({
        queryKey: queryKeys.assignmentRoot,
      });
      // The overall portion progress derives from completions too.
      this.queryClient.invalidateQueries({ queryKey: queryKeys.chaluka });
    },
  }));

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
    const learn = !this.checked().has(formatRef(ref));
    this.toggleMutation.mutate({ ref, groupId, learn });
  }
}
