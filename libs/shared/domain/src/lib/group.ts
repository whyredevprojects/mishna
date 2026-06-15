import { MishnaChalakim } from './mishna-chalakim';
import { MishnaStructure } from './mishna-structure';
import { Block, BlockRange, Commitment, IdGenerator, RandomSource } from './types';

// ---------------------------------------------------------------------------
// Group
//
// One full covering of the corpus, handed out as pre-set lots (chalakim). The
// group owns its members' blocks; each block is the set of lot numbers that user
// holds here. Every lot (1..118) is owned by at most one user, so a group's
// members' lots tile the whole corpus exactly once. A group is exhausted when all
// of its lots are taken.
//
// Allocation gives the first lot at random (via an injected RandomSource) and then
// prefers the consecutive next lots, so a user gets a continuous run of Mishna; see
// `addUser`. All corpus/lot lookups are delegated to the injected MishnaStructure
// and MishnaChalakim.
// ---------------------------------------------------------------------------

/** Serializable snapshot of a Group, for the persistence layer. */
export interface GroupState {
  id: string;
  blocks: Block[];
}

export interface GroupInit {
  id: string;
  blocks?: Block[];
}

export class Group {
  readonly id: string;
  private blocks: Block[];

  constructor(
    private readonly structure: MishnaStructure,
    private readonly chalakim: MishnaChalakim,
    private readonly idGen: IdGenerator,
    init: GroupInit,
  ) {
    this.id = init.id;
    this.blocks = init.blocks ?? [];
  }

  static fromState(
    structure: MishnaStructure,
    chalakim: MishnaChalakim,
    idGen: IdGenerator,
    state: GroupState,
  ): Group {
    return new Group(structure, chalakim, idGen, state);
  }

  // -- public interface ------------------------------------------------------

  /**
   * Assigns up to `count` free lots to the user (fewer only when the group runs out
   * of lots), excluding any lot numbers in `exclude` — the lots the user already
   * holds in other groups, so they never get the same lot (and the same mishnayot)
   * twice. Returns how many lots were assigned and which ones.
   *
   * The first lot is random; each subsequent lot is the one immediately after the
   * previous pick (`prev + 1`) so the user learns a continuous run of Mishna, and
   * only falls back to a random free lot when that next lot isn't available (taken,
   * excluded, or off the end of the corpus). `after` seeds the chain so consecutive
   * assignment can continue from a lot the user already holds (e.g. across a group
   * spill); leave it undefined to make the first pick random.
   */
  addUser(
    userId: string,
    count: number,
    commitment: Commitment,
    exclude: number[],
    random: RandomSource,
    after?: number,
  ): { allocated: number; lots: number[] } {
    if (count < 1) {
      return { allocated: 0, lots: [] };
    }
    const freeSet = new Set(this.freeLots(exclude)); // ascending corpus order
    const picked: number[] = [];
    let prev = after;
    for (let i = 0; i < count && freeSet.size > 0; i++) {
      let choice: number;
      if (prev !== undefined && freeSet.has(prev + 1)) {
        choice = prev + 1; // consecutive: the next lot
      } else {
        choice = pickRandom([...freeSet], random); // first lot / random fallback
      }
      picked.push(choice);
      freeSet.delete(choice);
      prev = choice;
    }
    if (picked.length === 0) {
      return { allocated: 0, lots: [] };
    }
    picked.sort((a, b) => a - b); // ascending lot number = corpus order
    this.blocks.push(this.buildBlock(userId, picked, commitment));
    return { allocated: picked.length, lots: picked };
  }

  /** Drops the user's block, freeing their lots back to the group. */
  removeUser(userId: string): void {
    this.blocks = this.blocks.filter((b) => b.userId !== userId);
  }

  /**
   * Admin override: replaces `userId`'s block with one built from the exact lot
   * numbers given (deduped, ascending). Unlike `addUser`, the lots need not be
   * free — a lot already held by another member becomes double-assigned (the admin
   * UI warns first), which `freeLots`/`capacityLeft` tolerate since taken lots are
   * tracked as a Set. An empty `lots` removes the user's block entirely. Throws on
   * an unknown lot number (via `getLotByNumber`).
   */
  setUserLots(userId: string, lots: number[], commitment: Commitment): void {
    this.removeUser(userId);
    const unique = [...new Set(lots)].sort((a, b) => a - b);
    if (unique.length === 0) {
      return;
    }
    this.blocks.push(this.buildBlock(userId, unique, commitment));
  }

  toState(): GroupState {
    return {
      id: this.id,
      blocks: this.blocks.map((b) => ({
        ...b,
        lots: [...b.lots],
        ranges: b.ranges.map((r) => ({ ...r })),
      })),
    };
  }

  /** Whether every lot is taken — no free lots remain. */
  isExhausted(): boolean {
    return this.freeLots().length === 0;
  }

  /** Mishnayot still available to allocate: the sum of the free lots' sizes. */
  capacityLeft(): number {
    return this.freeLots().reduce((sum, lot) => sum + this.lotSize(lot), 0);
  }

  // -- private ---------------------------------------------------------------

  /** Lot numbers already owned by some member of this group. */
  private takenLots(): Set<number> {
    const taken = new Set<number>();
    for (const block of this.blocks) {
      for (const lot of block.lots) {
        taken.add(lot);
      }
    }
    return taken;
  }

  /** Free lot numbers (corpus order), minus the group's taken lots and `exclude`. */
  private freeLots(exclude: Iterable<number> = []): number[] {
    const taken = this.takenLots();
    for (const lot of exclude) {
      taken.add(lot);
    }
    return this.chalakim.allLotNumbers().filter((lot) => !taken.has(lot));
  }

  /** Mishnayot in a lot. */
  private lotSize(lot: number): number {
    return this.structure.rangeSize(this.chalakim.getLotByNumber(lot).range);
  }

  /** Builds a user's block from their lot numbers, deriving ranges + totalSize. */
  private buildBlock(
    userId: string,
    lots: number[],
    commitment: Commitment,
  ): Block {
    const ranges: BlockRange[] = lots.map(
      (lot) => this.chalakim.getLotByNumber(lot).range,
    );
    const totalSize = ranges.reduce(
      (sum, range) => sum + this.structure.rangeSize(range),
      0,
    );
    return { id: this.idGen(), userId, lots, ranges, totalSize, commitment };
  }
}

/**
 * Picks one item uniformly at random from `pool` using the injected `random`. With
 * a `random` that always returns 0 it picks the first item — handy for
 * deterministic tests (`pool` is in ascending corpus order, so that's the lowest
 * free lot).
 */
function pickRandom(pool: number[], random: RandomSource): number {
  return pool[Math.floor(random() * pool.length)];
}
