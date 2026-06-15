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
// Allocation is random: `addUser` picks free lots uniformly (via an injected
// RandomSource). All corpus/lot lookups are delegated to the injected
// MishnaStructure and MishnaChalakim.
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
   * Hands the user random free lots up to a `budget` of mishnayot: keeps drawing
   * random free lots and giving them out while the next one fits in the remaining
   * budget, stopping at the first lot that would push them over. `exclude` is the
   * lots the user already holds in other groups, so they never get the same lot
   * (and the same mishnayot) twice. When `mustTakeAtLeastOne` is set the very
   * first lot is taken even if it overflows the budget — the "never fewer than
   * one lot" guarantee for the user's first group.
   *
   * `stopped` tells the caller why allocation ended: `'budget'` (the next lot
   * would exceed the budget — stop entirely) or `'groupFull'` (the group ran out
   * of free lots — the caller may spill into another group).
   */
  addUser(
    userId: string,
    commitment: Commitment,
    startDate: string,
    budget: number,
    exclude: number[],
    random: RandomSource,
    mustTakeAtLeastOne: boolean,
  ): {
    allocated: number;
    lots: number[];
    mishnayot: number;
    stopped: 'budget' | 'groupFull';
  } {
    const freeLots = this.freeLots(exclude);
    const free = sampleWithoutReplacement(freeLots, freeLots.length, random);
    const picked: number[] = [];
    let mishnayot = 0;
    let stopped: 'budget' | 'groupFull' = 'groupFull';
    for (const lot of free) {
      const size = this.lotSize(lot);
      const forced = mustTakeAtLeastOne && picked.length === 0;
      if (!forced && mishnayot + size > budget) {
        stopped = 'budget';
        break;
      }
      picked.push(lot);
      mishnayot += size;
    }
    if (picked.length === 0) {
      return { allocated: 0, lots: [], mishnayot: 0, stopped };
    }
    picked.sort((a, b) => a - b); // ascending lot number = corpus order
    this.blocks.push(this.buildBlock(userId, picked, commitment, startDate));
    return { allocated: picked.length, lots: picked, mishnayot, stopped };
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
  setUserLots(
    userId: string,
    lots: number[],
    commitment: Commitment,
    startDate?: string,
  ): void {
    const existing = this.blocks.find((b) => b.userId === userId)?.startDate;
    this.removeUser(userId);
    const unique = [...new Set(lots)].sort((a, b) => a - b);
    if (unique.length === 0) {
      return;
    }
    this.blocks.push(
      this.buildBlock(userId, unique, commitment, startDate ?? existing),
    );
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
    startDate?: string,
  ): Block {
    const ranges: BlockRange[] = lots.map(
      (lot) => this.chalakim.getLotByNumber(lot).range,
    );
    const totalSize = ranges.reduce(
      (sum, range) => sum + this.structure.rangeSize(range),
      0,
    );
    return {
      id: this.idGen(),
      userId,
      lots,
      ranges,
      totalSize,
      commitment,
      startDate,
    };
  }
}

/**
 * Picks `k` distinct items uniformly at random from `pool` (a partial
 * Fisher-Yates shuffle), using the injected `random`. With a `random` that always
 * returns 0 it picks the first `k` items in order — handy for deterministic tests.
 */
function sampleWithoutReplacement(
  pool: number[],
  k: number,
  random: RandomSource,
): number[] {
  const arr = [...pool];
  const out: number[] = [];
  for (let i = 0; i < k; i++) {
    const span = arr.length - i;
    const j = i + Math.min(span - 1, Math.floor(random() * span));
    [arr[i], arr[j]] = [arr[j], arr[i]];
    out.push(arr[i]);
  }
  return out;
}
