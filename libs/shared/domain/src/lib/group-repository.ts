import { Group, GroupState } from './group';
import { MishnaChalakim } from './mishna-chalakim';
import { MishnaStructure } from './mishna-structure';
import { IdGenerator } from './types';

// ---------------------------------------------------------------------------
// GroupRepository
//
// Port (hexagonal boundary) between the pure allocation domain and persistence.
// Production implementations talk to D1; tests use InMemoryGroupRepository.
// Methods are async so real storage (and Cloudflare Workers) fit naturally.
// ---------------------------------------------------------------------------

export interface GroupRepository {
  /** A group that still has free lots, or null if all groups are full. */
  loadNonExhaustedGroup(): Promise<Group | null>;
  /** Creates, persists, and returns a fresh group covering the whole corpus. */
  createGroup(): Promise<Group>;
  /** Persists the group's current state. */
  save(group: Group): Promise<void>;
  /** Every group in which the user currently holds a block. */
  loadGroupsForUser(userId: string): Promise<Group[]>;
}

/** In-memory GroupRepository for tests and local use. Stores GroupState snapshots. */
export class InMemoryGroupRepository implements GroupRepository {
  private readonly states = new Map<string, GroupState>();

  constructor(
    private readonly structure: MishnaStructure,
    private readonly chalakim: MishnaChalakim,
    private readonly idGen: IdGenerator,
  ) {}

  private hydrate(state: GroupState): Group {
    return Group.fromState(this.structure, this.chalakim, this.idGen, state);
  }

  async loadNonExhaustedGroup(): Promise<Group | null> {
    for (const state of this.states.values()) {
      const group = this.hydrate(state);
      if (!group.isExhausted()) {
        return group;
      }
    }
    return null;
  }

  async createGroup(): Promise<Group> {
    const group = new Group(this.structure, this.chalakim, this.idGen, {
      id: this.idGen(),
    });
    this.states.set(group.id, group.toState());
    return group;
  }

  async save(group: Group): Promise<void> {
    this.states.set(group.id, group.toState());
  }

  async loadGroupsForUser(userId: string): Promise<Group[]> {
    const result: Group[] = [];
    for (const state of this.states.values()) {
      if (state.blocks.some((b) => b.userId === userId)) {
        result.push(this.hydrate(state));
      }
    }
    return result;
  }

  /** Test/inspection helper: every stored group, hydrated. */
  async loadAll(): Promise<Group[]> {
    return [...this.states.values()].map((s) => this.hydrate(s));
  }
}
