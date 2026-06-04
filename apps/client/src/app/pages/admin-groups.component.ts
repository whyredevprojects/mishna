import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  inject,
  signal,
} from '@angular/core';
import { AdminService } from '../services/admin.service';
import { AdminGroup } from '../models/api.types';

/** Group stats: how many groups, and each group's fill + progress. */
@Component({
  selector: 'app-admin-groups',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      wa-card {
        width: 100%;
      }
      .group-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .pct {
        font-variant-numeric: tabular-nums;
        font-size: var(--wa-font-size-s, 0.875rem);
      }
    `,
  ],
  template: `
    <div class="stack">
      @if (loading()) {
        <wa-spinner style="font-size: 2rem"></wa-spinner>
      } @else if (error()) {
        <wa-callout variant="danger">{{ error() }}</wa-callout>
      } @else {
        <p class="muted">{{ count() }} active {{ count() === 1 ? 'group' : 'groups' }}</p>

        @for (group of groups(); track group.id; let i = $index) {
          <wa-card>
            <div slot="header" class="group-head">
              <strong>Group {{ i + 1 }}</strong>
              <span class="pct">{{ pct(group) }}%</span>
            </div>
            <div class="stack">
              <span class="muted"
                >{{ group.memberCount }}
                {{ group.memberCount === 1 ? 'member' : 'members' }}</span
              >
              <wa-progress-bar [value]="pct(group)"></wa-progress-bar>
            </div>
          </wa-card>
        }
      }
    </div>
  `,
})
export class AdminGroupsComponent {
  private readonly admin = inject(AdminService);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly count = signal(0);
  protected readonly groups = signal<AdminGroup[]>([]);

  constructor() {
    this.admin.groups().subscribe({
      next: (res) => {
        this.count.set(res.count);
        this.groups.set(res.groups);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load group stats.');
        this.loading.set(false);
      },
    });
  }

  protected pct(group: AdminGroup): number {
    return Math.round(group.progress * 100);
  }
}
