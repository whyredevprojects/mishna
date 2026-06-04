import { CUSTOM_ELEMENTS_SCHEMA, Component, inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { AdminService } from '../services/admin.service';
import { AdminGroup } from '../models/api.types';
import { adminGroupsQueryOptions } from '../queries/queries';

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
      @if (query.isPending()) {
        <wa-spinner style="font-size: 2rem"></wa-spinner>
      } @else if (query.isError()) {
        <wa-callout variant="danger">Could not load group stats.</wa-callout>
      } @else if (query.data(); as res) {
        <p class="muted">{{ res.count }} active {{ res.count === 1 ? 'group' : 'groups' }}</p>

        @for (group of res.groups; track group.id; let i = $index) {
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

  protected readonly query = injectQuery(() =>
    adminGroupsQueryOptions(this.admin),
  );

  protected pct(group: AdminGroup): number {
    return Math.round(group.progress * 100);
  }
}
