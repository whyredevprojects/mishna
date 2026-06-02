import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  inject,
  signal,
} from '@angular/core';
import { AssignmentService } from '../services/assignment.service';
import { Assignment } from '../models/api.types';
import { MishnaListComponent } from '../components/mishna-list.component';
import { formatLongDate, toIsoDate } from '../util/format';

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
        @if (loading()) {
          <wa-spinner></wa-spinner>
        } @else if (assignment(); as a) {
          <app-mishna-list [mishnas]="a.mishnas"></app-mishna-list>
        } @else if (error()) {
          <wa-callout variant="danger">{{ error() }}</wa-callout>
        }
      </wa-card>
    </div>
  `,
})
export class ReviewComponent {
  private readonly assignments = inject(AssignmentService);

  protected readonly date = signal(toIsoDate(new Date()));
  protected readonly longDate = signal(formatLongDate(toIsoDate(new Date())));
  protected readonly assignment = signal<Assignment | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.load(this.date());
  }

  protected onDate(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value) {
      this.date.set(value);
      this.load(value);
    }
  }

  private load(date: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.longDate.set(formatLongDate(date));
    this.assignments.forDate(date).subscribe({
      next: (a) => {
        this.assignment.set(a);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load that day’s assignment.');
        this.assignment.set(null);
        this.loading.set(false);
      },
    });
  }
}
