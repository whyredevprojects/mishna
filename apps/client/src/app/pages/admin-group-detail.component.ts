import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';
import { AdminService } from '../services/admin.service';
import { ToastService } from '../services/toast.service';
import { AdminGroupDetail, AdminGroupMember } from '../models/api.types';
import { queryKeys } from '../queries/query-keys';
import {
  adminGroupQueryOptions,
  adminLotsQueryOptions,
} from '../queries/queries';
import { DataTableComponent, TableColumn } from '../ui/data-table.component';
import { formatRef } from '../util/format';

/** One row of the lot editor: a stable id (so inputs aren't recreated on edit). */
interface LotInput {
  id: number;
  value: string;
}

/** One group: progress plus its members (identity, verification, editable lots). */
@Component({
  selector: 'app-admin-group-detail',
  imports: [RouterLink, DataTableComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: [
    `
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-m, 0.75rem);
      }
      .pct {
        font-variant-numeric: tabular-nums;
      }
      .back {
        font-size: var(--wa-font-size-s, 0.875rem);
      }
      .lots-edit {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wa-space-2xs, 0.25rem);
      }
      .lot-input {
        display: flex;
        align-items: center;
      }
      .lot-input wa-input {
        inline-size: 5rem;
      }
      .warn {
        display: flex;
        align-items: center;
        gap: var(--wa-space-2xs, 0.25rem);
        margin-block-start: var(--wa-space-2xs, 0.25rem);
        color: var(--wa-color-warning-60, #b45309);
        font-size: var(--wa-font-size-s, 0.875rem);
      }
      .row-actions {
        display: flex;
        align-items: center;
        gap: var(--wa-space-2xs, 0.25rem);
        white-space: nowrap;
      }
      .lot-ref {
        display: grid;
        gap: var(--wa-space-2xs, 0.25rem);
        max-block-size: 60vh;
        overflow-y: auto;
      }
      .lot-ref-row {
        display: grid;
        grid-template-columns: 2.5rem 5rem 1fr auto;
        gap: var(--wa-space-s, 0.5rem);
        align-items: baseline;
        font-size: var(--wa-font-size-s, 0.875rem);
      }
    `,
  ],
  template: `
    <div class="stack">
      <a class="back" routerLink="/admin/groups">← All groups</a>
      @if (query.isPending()) {
        <wa-spinner style="font-size: 2rem"></wa-spinner>
      } @else if (query.isError()) {
        <wa-callout variant="danger">Could not load this group.</wa-callout>
      } @else if (query.data(); as g) {
        <wa-card>
          <div slot="header" class="head">
            <strong>{{ g.memberCount }} {{ g.memberCount === 1 ? 'member' : 'members' }}</strong>
            <span class="pct">{{ pct(g) }}% covered</span>
          </div>
          <wa-progress-bar [value]="pct(g)"></wa-progress-bar>
        </wa-card>

        <app-data-table
          [columns]="columns"
          [rows]="g.members"
          emptyText="No members."
        >
          <ng-template #cell let-row let-col="col">
            @switch (col.key) {
              @case ('name') {
                <a [routerLink]="['/admin/users', row.id]">{{
                  row.name || '(no name)'
                }}</a>
              }
              @case ('email') {
                <span class="muted">{{ row.email }}</span>
              }
              @case ('lots') {
                @if (editingId() === row.id) {
                  <div class="lots-edit">
                    @for (entry of draft(); track entry.id) {
                      <div class="lot-input">
                        <wa-input
                          type="number"
                          size="small"
                          min="1"
                          max="118"
                          [value]="entry.value"
                          (input)="setAt(entry.id, $event)"
                          (keydown.enter)="addBlank()"
                        ></wa-input>
                        <wa-button
                          appearance="plain"
                          size="small"
                          title="Remove"
                          (click)="removeAt(entry.id)"
                        >
                          <wa-icon name="xmark" label="Remove"></wa-icon>
                        </wa-button>
                      </div>
                    }
                    <wa-button
                      appearance="outlined"
                      size="small"
                      (click)="addBlank()"
                    >
                      <wa-icon slot="start" name="plus"></wa-icon>
                      Add
                    </wa-button>
                  </div>
                  @for (c of conflicts(); track c.lot) {
                    <div class="warn">
                      <wa-icon name="triangle-exclamation"></wa-icon>
                      Lot {{ c.lot }} is already assigned to
                      {{ c.holders.join(', ') }} — saving will double-assign it.
                    </div>
                  }
                } @else {
                  @if (row.lots.length) {
                    {{ labels(row.lots) }}
                  } @else {
                    <span class="muted">—</span>
                  }
                }
              }
              @case ('verified') {
                @if (row.emailVerified) {
                  <wa-tag size="small" variant="success">Verified</wa-tag>
                } @else {
                  <wa-tag size="small" variant="warning">Pending</wa-tag>
                }
              }
              @case ('actions') {
                @if (editingId() === row.id) {
                  <div class="row-actions">
                    <wa-button
                      size="small"
                      variant="brand"
                      [attr.loading]="saving() ? '' : null"
                      (click)="save(row)"
                    >
                      Save
                    </wa-button>
                    <wa-button
                      size="small"
                      appearance="plain"
                      (click)="cancelEdit()"
                    >
                      Cancel
                    </wa-button>
                    <wa-button
                      size="small"
                      appearance="plain"
                      title="Lot reference"
                      (click)="refOpen.set(true)"
                    >
                      <wa-icon name="circle-question" label="Lot reference"></wa-icon>
                    </wa-button>
                  </div>
                } @else {
                  <wa-button
                    size="small"
                    appearance="plain"
                    title="Edit lots"
                    (click)="startEdit(row)"
                  >
                    <wa-icon name="pencil" label="Edit lots"></wa-icon>
                  </wa-button>
                }
              }
            }
          </ng-template>
        </app-data-table>
      }
    </div>

    <wa-dialog
      label="All lots"
      [attr.open]="refOpen() ? '' : null"
      (wa-after-hide)="refOpen.set(false)"
    >
      @if (lotsQuery.data(); as catalog) {
        <div class="lot-ref">
          @for (l of catalog; track l.lot) {
            <div class="lot-ref-row">
              <strong>{{ l.lot }}</strong>
              <span>{{ l.label }}</span>
              <span class="muted">{{ formatRef(l.start) }} – {{ formatRef(l.end) }}</span>
              <span class="muted">({{ l.size }})</span>
            </div>
          }
        </div>
      } @else {
        <wa-spinner></wa-spinner>
      }
      <wa-button slot="footer" appearance="plain" (click)="refOpen.set(false)">
        Close
      </wa-button>
    </wa-dialog>
  `,
})
export class AdminGroupDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly admin = inject(AdminService);
  private readonly toast = inject(ToastService);
  private readonly queryClient = inject(QueryClient);

  private readonly id = this.route.snapshot.paramMap.get('id') ?? '';

  protected readonly formatRef = formatRef;

  protected readonly query = injectQuery(() =>
    adminGroupQueryOptions(this.admin, this.id),
  );
  protected readonly lotsQuery = injectQuery(() =>
    adminLotsQueryOptions(this.admin),
  );

  /** lot number -> catalog entry, for rendering `54 (Peah:1)` labels. */
  private readonly lotMap = computed(
    () => new Map((this.lotsQuery.data() ?? []).map((l) => [l.lot, l])),
  );

  protected readonly columns: TableColumn[] = [
    { key: 'name', label: 'Member' },
    { key: 'email', label: 'Email' },
    { key: 'lots', label: 'Lots' },
    { key: 'verified', label: 'Verified' },
    { key: 'actions', label: '' },
  ];

  /** The member currently being edited (one row at a time), or null. */
  protected readonly editingId = signal<string | null>(null);
  /** The lot inputs for the row being edited. */
  protected readonly draft = signal<LotInput[]>([]);
  protected readonly refOpen = signal(false);
  private nextInputId = 0;

  protected readonly setLotsMutation = injectMutation(() => ({
    mutationFn: (vars: { userId: string; lots: number[] }) =>
      firstValueFrom(this.admin.setMemberLots(this.id, vars.userId, vars.lots)),
    onSuccess: (_data: unknown, vars: { userId: string; lots: number[] }) => {
      this.cancelEdit();
      // Lots changed for this group (members + progress/capacity), the user, and lists.
      this.queryClient.invalidateQueries({
        queryKey: queryKeys.adminGroup(this.id),
      });
      this.queryClient.invalidateQueries({ queryKey: queryKeys.adminGroups });
      this.queryClient.invalidateQueries({
        queryKey: queryKeys.adminUser(vars.userId),
      });
      this.queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
      this.toast.success('Lots updated.');
    },
    onError: () => this.toast.error('Could not update the lots.'),
  }));

  protected readonly saving = computed(() => this.setLotsMutation.isPending());

  /** Lots in the draft that a different member of this group already holds. */
  protected readonly conflicts = computed(() => {
    const id = this.editingId();
    const data = this.query.data();
    if (!id || !data) {
      return [] as { lot: number; holders: string[] }[];
    }
    const parsed = this.parseDraft();
    if (!parsed.valid) {
      return [];
    }
    const others = data.members.filter((m) => m.id !== id);
    const out: { lot: number; holders: string[] }[] = [];
    for (const lot of parsed.lots) {
      const holders = others
        .filter((m) => m.lots.includes(lot))
        .map((m) => m.name || m.email || m.id);
      if (holders.length) {
        out.push({ lot, holders });
      }
    }
    return out;
  });

  protected pct(g: AdminGroupDetail): number {
    return Math.round(g.progress * 100);
  }

  protected label(lot: number): string {
    const entry = this.lotMap().get(lot);
    return entry ? `${lot} (${entry.label})` : String(lot);
  }

  protected labels(lots: number[]): string {
    return lots.map((l) => this.label(l)).join(', ');
  }

  protected startEdit(row: AdminGroupMember): void {
    this.editingId.set(row.id);
    this.draft.set(
      row.lots.map((l) => ({ id: this.nextInputId++, value: String(l) })),
    );
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.draft.set([]);
  }

  protected addBlank(): void {
    this.draft.update((d) => [...d, { id: this.nextInputId++, value: '' }]);
  }

  protected removeAt(id: number): void {
    this.draft.update((d) => d.filter((e) => e.id !== id));
  }

  protected setAt(id: number, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.draft.update((d) =>
      d.map((e) => (e.id === id ? { ...e, value } : e)),
    );
  }

  protected save(row: AdminGroupMember): void {
    const { lots, valid } = this.parseDraft();
    if (!valid) {
      this.toast.error('Lot numbers must be whole numbers between 1 and 118.');
      return;
    }
    this.setLotsMutation.mutate({ userId: row.id, lots });
  }

  /** Parses the draft inputs into a deduped lot-number list; `valid` is false on a bad entry. */
  private parseDraft(): { lots: number[]; valid: boolean } {
    const lots: number[] = [];
    for (const e of this.draft()) {
      const t = e.value.trim();
      if (t === '') {
        continue;
      }
      const n = Number(t);
      if (!Number.isInteger(n) || n < 1 || n > 118) {
        return { lots: [], valid: false };
      }
      lots.push(n);
    }
    return { lots: [...new Set(lots)], valid: true };
  }
}
