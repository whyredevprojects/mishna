import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  effect,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MishnaRef } from '../models/api.types';
import { MishnaText, MishnaTextService } from '../services/mishna-text.service';
import { formatRef, formatRefHe } from '../util/format';

/**
 * One mishna: its Hebrew text, an English toggle, and the "I Learned This Baal
 * Peh" completion button. Text is loaded on demand from {@link MishnaTextService};
 * completion state is owned by the parent (see TodayCardComponent).
 *
 * In {@link collapsible} mode the card instead renders a compact, clickable
 * disclosure row (ref + a learned/pending tag) that reveals the text inline only
 * when opened — and defers loading the text until then (see the load effect).
 */
@Component({
  selector: 'app-mishna-card',
  imports: [NgTemplateOutlet],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      :host {
        display: block;
      }
      wa-card.learned::part(header) {
        background-color: var(--wa-color-success-fill-quiet, #dcfce7);
      }
      .header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--wa-space-s, 0.5rem);
      }
      .header .he {
        direction: rtl;
        color: var(--wa-color-text-quiet, #6b6b6b);
        font-weight: var(--wa-font-weight-normal, 400);
      }
      .hebrew {
        direction: rtl;
        text-align: center;
        font-size: var(--wa-font-size-l, 1.25rem);
        line-height: 2;
      }
      .english {
        margin-block-start: var(--wa-space-m, 0.75rem);
        padding-block-start: var(--wa-space-m, 0.75rem);
        border-block-start: var(--wa-border-width-s, 1px) solid
          var(--wa-color-surface-border, #d8d2c8);
        line-height: 1.6;
        color: var(--wa-color-text-quiet, #6b6b6b);
      }
      .spinner-wrap {
        display: flex;
        justify-content: center;
        padding-block: var(--wa-space-l, 1rem);
      }
      .footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--wa-space-s, 0.5rem);
      }
      /* Collapsible (disclosure) mode — a compact row that opens to reveal the text. */
      .row-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-s, 0.5rem);
        padding-block: var(--wa-space-2xs, 0.25rem);
      }
      /* The disclosure trigger: the checkbox/tag sits beside it (not inside), so
         toggling it never bubbles into this and expands the row. */
      .row-head {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs, 0.375rem);
        flex: 1;
        min-width: 0;
        cursor: pointer;
      }
      .row-head:focus-visible {
        outline: var(--wa-border-width-l, 2px) solid
          var(--wa-color-brand-fill-loud, #2563eb);
        outline-offset: 2px;
        border-radius: var(--wa-border-radius-s, 0.25rem);
      }
      .row-head .ref {
        font-variant-numeric: tabular-nums;
      }
      .chev {
        color: var(--wa-color-text-quiet, #6b6b6b);
        font-size: 0.85em;
      }
      .row-body {
        padding-block-end: var(--wa-space-s, 0.5rem);
      }
    `,
  ],
  template: `
    @if (collapsible()) {
      <div class="disclosure">
        <div class="row-top">
          <div
            class="row-head"
            role="button"
            tabindex="0"
            [attr.aria-expanded]="expanded()"
            (click)="toggle()"
            (keydown.enter)="toggle()"
            (keydown.space)="onSpace($event)"
          >
            <wa-icon
              class="chev"
              [attr.name]="expanded() ? 'chevron-down' : 'chevron-right'"
            ></wa-icon>
            <span class="ref">{{ ref().perek }}:{{ ref().mishna }}</span>
          </div>
          @if (showCheckbox()) {
            <wa-checkbox
              size="small"
              [attr.checked]="done() ? '' : null"
              [attr.aria-label]="'Mark ' + format(ref()) + ' learned'"
              (change)="learned.emit()"
            ></wa-checkbox>
          } @else if (done()) {
            <wa-tag size="small" variant="success">Learned</wa-tag>
          } @else {
            <wa-tag size="small">Pending</wa-tag>
          }
        </div>

        @if (expanded()) {
          <div class="row-body">
            <ng-container [ngTemplateOutlet]="bodyTpl"></ng-container>
            @if (showEnglishToggle()) {
              <div class="footer">
                <ng-container [ngTemplateOutlet]="englishToggleTpl"></ng-container>
              </div>
            }
          </div>
        }
      </div>
    } @else {
      <wa-card [class.learned]="!showCheckbox() && done()">
        <div slot="header" class="header">
          <strong>{{ format(ref()) }}</strong>
          @if (text(); as t) {
            <span class="he hebrew-text">{{
              formatHe(t.tractateHebrewName, ref().perek, ref().mishna)
            }}</span>
          }
        </div>

        <ng-container [ngTemplateOutlet]="bodyTpl"></ng-container>

        <div slot="footer" class="footer">
          @if (showEnglishToggle()) {
            <ng-container [ngTemplateOutlet]="englishToggleTpl"></ng-container>
          }
          @if (showCheckbox()) {
            <wa-checkbox
              [attr.checked]="done() ? '' : null"
              (change)="learned.emit()"
            >I Learned This Baal Peh</wa-checkbox>
          }
        </div>
      </wa-card>
    }

    <ng-template #bodyTpl>
      @if (loading()) {
        <div class="spinner-wrap"><wa-spinner></wa-spinner></div>
      } @else if (text(); as t) {
        <p class="hebrew hebrew-text">{{ t.hebrew }}</p>
        @if (showEnglish()) {
          <p class="english">{{ t.english }}</p>
        }
      } @else {
        <p class="muted">Text unavailable for this mishna.</p>
      }
    </ng-template>

    <ng-template #englishToggleTpl>
      <wa-button appearance="outlined" (click)="showEnglish.set(!showEnglish())">
        <wa-icon slot="start" name="language"></wa-icon>
        {{ showEnglish() ? 'Hide English' : 'English' }}
      </wa-button>
    </ng-template>
  `,
})
export class MishnaCardComponent {
  readonly ref = input.required<MishnaRef>();
  readonly done = input.required<boolean>();
  /** Show the "I Learned This" checkbox; when false, no completion control is shown. */
  readonly showCheckbox = input(true);
  /** Render the footer English toggle; set false when a parent owns English visibility. */
  readonly showEnglishToggle = input(true);
  /** English visibility — internal when {@link showEnglishToggle}, else parent-driven. */
  readonly showEnglish = model(false);
  /**
   * Render as a compact disclosure row whose heading toggles the text open/closed,
   * collapsed by default. Text loads lazily on first expand (see the load effect),
   * so a long list of these doesn't fetch a tractate per row up front.
   */
  readonly collapsible = input(false);
  readonly learned = output<void>();

  protected readonly format = formatRef;
  protected readonly formatHe = formatRefHe;

  /** Open state in {@link collapsible} mode; ignored otherwise. */
  protected readonly expanded = signal(false);

  protected readonly text = signal<MishnaText | null>(null);
  protected readonly loading = signal(true);

  private readonly textService = inject(MishnaTextService);
  private loadToken = 0;

  constructor() {
    // (Re)load text whenever the ref changes; ignore stale resolutions. In
    // collapsible mode, defer the lookup until the card is actually expanded —
    // otherwise a long list (e.g. /my-mishnayos) would fetch a tractate JSON per
    // row on render. Reading expanded() here re-runs the effect on first open.
    effect(() => {
      if (this.collapsible() && !this.expanded()) {
        return;
      }
      const ref = this.ref();
      const token = ++this.loadToken;
      this.loading.set(true);
      // Self-managed mode collapses English on each new mishna; when a parent owns
      // the toggle, leave the bound value alone.
      if (this.showEnglishToggle()) {
        this.showEnglish.set(false);
      }
      this.textService
        .lookup(ref)
        .then((t) => {
          if (token === this.loadToken) {
            this.text.set(t);
          }
        })
        .catch(() => {
          if (token === this.loadToken) {
            this.text.set(null);
          }
        })
        .finally(() => {
          if (token === this.loadToken) {
            this.loading.set(false);
          }
        });
    });
  }

  /** Toggle the disclosure (collapsible mode). */
  protected toggle(): void {
    this.expanded.update((v) => !v);
  }

  /** Space on the disclosure header toggles it without scrolling the page. */
  protected onSpace(event: Event): void {
    event.preventDefault();
    this.toggle();
  }
}
