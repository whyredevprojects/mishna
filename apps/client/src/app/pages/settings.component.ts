import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  inject,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';
import { AuthService } from '../services/auth.service';
import { SettingsService } from '../services/settings.service';
import { ToastService } from '../services/toast.service';
import { DayOfWeek, EmailPrefs } from '../models/api.types';

const DAY_NAMES = [
  $localize`:@@day.sunday:Sunday`,
  $localize`:@@day.monday:Monday`,
  $localize`:@@day.tuesday:Tuesday`,
  $localize`:@@day.wednesday:Wednesday`,
  $localize`:@@day.thursday:Thursday`,
  $localize`:@@day.friday:Friday`,
  $localize`:@@day.saturday:Saturday`,
];

/** Account info plus the editable email preferences (timezone + reminder schedule). */
@Component({
  selector: 'app-settings',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
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
        word-break: break-all;
      }
      .mono {
        font-family: var(--wa-font-family-code, monospace);
        font-size: var(--wa-font-size-s, 0.875rem);
      }
      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-m, 0.75rem);
      }
      .tz-row {
        display: flex;
        align-items: anchor-center;
        gap: var(--wa-space-s, 0.5rem);
      }
      .tz-row wa-select {
        flex: 1;
      }
      .actions {
        margin-top: var(--wa-space-m, 0.75rem);
      }
      .pref-hint {
        margin: 0;
        color: var(--wa-color-text-quiet, #6b6358);
        font-size: var(--wa-font-size-s, 0.875rem);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="stack readable">
      <h2 i18n="@@settings.title">Settings</h2>

      @if (auth.me()?.user; as user) {
        <wa-card>
          <strong slot="header" i18n="@@settings.account">Account</strong>
          <dl>
            <dt i18n="@@settings.name">Name</dt>
            <dd>{{ user.name || '—' }}</dd>
            <dt i18n="@@settings.email">Email</dt>
            <dd>{{ user.email || '—' }}</dd>
            <dt i18n="@@settings.userId">User ID</dt>
            <dd class="mono">{{ user.id }}</dd>
            <dt i18n="@@settings.role">Role</dt>
            <dd>{{ user.role || 'user' }}</dd>
          </dl>
        </wa-card>

        <wa-card>
          <strong slot="header" i18n="@@settings.emailPreferences"
            >Email preferences</strong
          >
          @if (loading()) {
            <wa-spinner style="font-size: 2rem"></wa-spinner>
          } @else {
            <div class="fields">
              <div class="tz-row">
                <wa-select
                  i18n-label="@@settings.timezoneLabel"
                  label="Timezone"
                  i18n-hint="@@settings.timezoneHint"
                  hint="Emails are sent at 8:00 AM in this timezone."
                  [value]="timezone()"
                  (change)="timezone.set($any($event.target).value)"
                >
                  @for (tz of zones; track tz) {
                    <wa-option [value]="tz">{{ tz }}</wa-option>
                  }
                </wa-select>
                <wa-button appearance="outlined" (click)="detectTimezone()">
                  <wa-icon slot="start" name="location-crosshairs"></wa-icon>
                  <span i18n="@@settings.detect">Detect</span>
                </wa-button>
              </div>

              <wa-select
                i18n-label="@@settings.weeklyDayLabel"
                label="Weekly email day"
                i18n-hint="@@settings.weeklyDayHint"
                hint="The day you receive that week's mishnayos (in Hebrew)."
                [value]="String(weeklyEmailDow())"
                (change)="weeklyEmailDow.set(asDow($any($event.target).value))"
              >
                @for (d of days; track d.value) {
                  <wa-option [value]="String(d.value)">{{ d.name }}</wa-option>
                }
              </wa-select>

              <wa-checkbox
                i18n="@@settings.weeklyEnabled"
                [attr.checked]="weeklyEnabled() ? '' : null"
                (change)="weeklyEnabled.set($any($event.target).checked)"
              >
                Send me the weekly mishnayos email
              </wa-checkbox>

              <wa-divider></wa-divider>

              <wa-select
                i18n-label="@@settings.reminderDayLabel"
                label="Reminder email day"
                i18n-hint="@@settings.reminderDayHint"
                hint="A nudge if you haven't finished that week's mishnayos yet."
                [value]="String(reminderEmailDow())"
                (change)="
                  reminderEmailDow.set(asDow($any($event.target).value))
                "
              >
                @for (d of days; track d.value) {
                  <wa-option [value]="String(d.value)">{{ d.name }}</wa-option>
                }
              </wa-select>

              <wa-checkbox
                i18n="@@settings.reminderEnabled"
                [attr.checked]="reminderEnabled() ? '' : null"
                (change)="reminderEnabled.set($any($event.target).checked)"
              >
                Send me the weekly reminder email
              </wa-checkbox>

              <!--
                Both flags are the ones the emails' one-click unsubscribe writes
                (apps/server GET/POST /api/unsubscribe), so this screen is also how a
                user re-subscribes. Keep in sync with apps/mobile's settings screen.
              -->
              <p class="pref-hint" i18n="@@settings.unsubscribeHint">
                The unsubscribe link in those emails turns both of these off — you
                can switch them back on here any time.
              </p>

              <div class="actions">
                <wa-button
                  variant="brand"
                  [attr.loading]="saving() ? '' : null"
                  (click)="save()"
                >
                  <span i18n="@@settings.save">Save preferences</span>
                </wa-button>
              </div>
            </div>
          }
        </wa-card>
      } @else {
        <wa-spinner style="font-size: 2rem"></wa-spinner>
      }
    </div>
  `,
})
export class SettingsComponent {
  protected readonly auth = inject(AuthService);
  private readonly settings = inject(SettingsService);
  private readonly toast = inject(ToastService);

  protected readonly String = String;
  protected readonly days = DAY_NAMES.map((name, value) => ({ name, value }));
  protected readonly zones = this.timezoneList();

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly timezone = signal('America/New_York');
  protected readonly weeklyEmailDow = signal<DayOfWeek>(0);
  protected readonly reminderEmailDow = signal<DayOfWeek>(4);
  protected readonly weeklyEnabled = signal(true);
  protected readonly reminderEnabled = signal(true);

  constructor() {
    this.load();
  }

  private load(): void {
    this.settings.getPreferences().subscribe({
      next: (p) => {
        this.timezone.set(p.timezone);
        this.weeklyEmailDow.set(p.weeklyEmailDow);
        this.reminderEmailDow.set(p.reminderEmailDow);
        this.weeklyEnabled.set(p.weeklyEnabled);
        this.reminderEnabled.set(p.reminderEnabled);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.error(
          $localize`:@@settings.loadError:Could not load your preferences.`,
        );
      },
    });
  }

  /** Coerce a select value ("0".."6") to a DayOfWeek. */
  protected asDow(value: string): DayOfWeek {
    return Number(value) as DayOfWeek;
  }

  /** Set the timezone field to the browser's detected zone. */
  protected detectTimezone(): void {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected && this.zones.includes(detected)) {
      this.timezone.set(detected);
    }
  }

  protected save(): void {
    this.saving.set(true);
    const prefs: EmailPrefs = {
      timezone: this.timezone(),
      weeklyEmailDow: this.weeklyEmailDow(),
      reminderEmailDow: this.reminderEmailDow(),
      weeklyEnabled: this.weeklyEnabled(),
      reminderEnabled: this.reminderEnabled(),
    };
    this.settings.updatePreferences(prefs).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success($localize`:@@settings.saved:Preferences saved.`);
      },
      error: () => {
        this.saving.set(false);
        this.toast.error(
          $localize`:@@settings.saveError:Could not save your preferences.`,
        );
      },
    });
  }

  /** All IANA zones (native `Intl.supportedValuesOf`), with the current value
   *  guaranteed present. Falls back to the detected zone if the API is missing. */
  private timezoneList(): string[] {
    const supported = (
      Intl as typeof Intl & {
        supportedValuesOf?: (key: string) => string[];
      }
    ).supportedValuesOf;
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const zones = supported
      ? supported('timeZone')
      : [detected, 'America/New_York', 'Asia/Jerusalem'];
    return zones.includes(detected) ? zones : [detected, ...zones];
  }
}
