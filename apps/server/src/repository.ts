import {
  Group,
  GroupRepository,
  IdGenerator,
  MishnaChalakim,
  MishnaStructure,
} from '@mishna/domain';

// ---------------------------------------------------------------------------
// D1GroupRepository
//
// Production adapter for the domain's GroupRepository port, backed by a
// Cloudflare D1 database (binding `DB`). Behaviorally mirrors
// InMemoryGroupRepository: stores each group as its JSON GroupState and
// hydrates via Group.fromState.
//
// `save` additionally denormalizes the row's `exhausted` / `capacity_left`
// columns and rebuilds the group's `group_members` rows, all in one atomic
// db.batch() so a row's membership never drifts from its state. Concurrency
// across the load->mutate->save cycle is the AllocatorDO's responsibility, not
// this adapter's.
// ---------------------------------------------------------------------------

interface GroupStateRow {
  state: string;
}

export class D1GroupRepository implements GroupRepository {
  constructor(
    private readonly db: D1Database,
    private readonly structure: MishnaStructure,
    private readonly chalakim: MishnaChalakim,
    private readonly idGen: IdGenerator,
  ) {}

  private hydrate(stateJson: string): Group {
    return Group.fromState(
      this.structure,
      this.chalakim,
      this.idGen,
      JSON.parse(stateJson),
    );
  }

  async loadNonExhaustedGroup(): Promise<Group | null> {
    const row = await this.db
      .prepare('SELECT state FROM groups WHERE exhausted = 0 LIMIT 1')
      .first<GroupStateRow>();
    return row ? this.hydrate(row.state) : null;
  }

  async createGroup(): Promise<Group> {
    const group = new Group(this.structure, this.chalakim, this.idGen, {
      id: this.idGen(),
    });
    await this.persist(group);
    return group;
  }

  async save(group: Group): Promise<void> {
    await this.persist(group);
  }

  async loadGroupsForUser(userId: string): Promise<Group[]> {
    const { results } = await this.db
      .prepare(
        `SELECT g.state AS state
           FROM groups g
           JOIN group_members m ON g.id = m.group_id
          WHERE m.user_id = ?`,
      )
      .bind(userId)
      .all<GroupStateRow>();
    return results.map((r) => this.hydrate(r.state));
  }

  // -- persistence ------------------------------------------------------------

  /** Upserts the group row and atomically rebuilds its membership rows. */
  private async persist(group: Group): Promise<void> {
    const state = group.toState();
    const exhausted = group.isExhausted() ? 1 : 0;
    const capacityLeft = group.capacityLeft();
    const memberIds = [...new Set(state.blocks.map((b) => b.userId))];
    const now = Date.now();

    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO groups (id, state, exhausted, capacity_left, updated_at)
             VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             state = excluded.state,
             exhausted = excluded.exhausted,
             capacity_left = excluded.capacity_left,
             updated_at = excluded.updated_at`,
        )
        .bind(group.id, JSON.stringify(state), exhausted, capacityLeft, now),
      this.db
        .prepare('DELETE FROM group_members WHERE group_id = ?')
        .bind(group.id),
      ...memberIds.map((userId) =>
        this.db
          .prepare(
            'INSERT INTO group_members (group_id, user_id) VALUES (?, ?)',
          )
          .bind(group.id, userId),
      ),
    ];

    await this.db.batch(statements);
  }
}
