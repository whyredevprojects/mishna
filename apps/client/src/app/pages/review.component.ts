import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { AssignmentService } from '../services/assignment.service';
import { MishnaListComponent } from '../components/mishna-list.component';
import { formatLongDate, toIsoDate } from '../util/format';
import { assignmentByDateQueryOptions } from '../queries/queries';

/** Browse the caller's assignment for any chosen day. */
@Component({
  selector: 'app-review',
  imports: [MishnaListComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .picker {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs, 0.125rem);
      }
      input[type='date'] {
        font: inherit;
        padding: var(--wa-space-s, 0.5rem);
        border: var(--wa-border-width-s, 1px) solid
          var(--wa-color-surface-border, #d8d2c8);
        border-radius: var(--wa-border-radius-m, 0.5rem);
        background: var(--wa-color-surface-default, #fff);
      }
    `,
  ],
  template: `
    <div class="stack">
      <h2>Review</h2>

      <label class="picker">
        <span class="muted">Choose a date</span>
        <input type="date" [value]="date()" (change)="onDate($event)" />
      </label>

      <wa-card>
        <strong slot="header">{{ longDate() }}</strong>
        @if (query.isPending()) {
          <wa-spinner></wa-spinner>
        } @else if (query.data(); as a) {
          <app-mishna-list [mishnas]="a.mishnas"></app-mishna-list>
        } @else if (query.isError()) {
          <wa-callout variant="danger">Could not load that day’s assignment.</wa-callout>
        }
      </wa-card>
    </div>
  `,
})
export class ReviewComponent {
  private readonly assignments = inject(AssignmentService);

  protected readonly date = signal(toIsoDate(new Date()));
  protected readonly longDate = computed(() => formatLongDate(this.date()));

  // Keyed by date: switching dates re-keys the query (cache hit on revisit), and
  // each day's assignment is retained in the cache.
  protected readonly query = injectQuery(() =>
    assignmentByDateQueryOptions(this.assignments, this.date()),
  );

  protected onDate(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value) {
      this.date.set(value);
    }
  }
}
