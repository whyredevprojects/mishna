import { MishnaStructure } from './mishna-structure';
import { Block, BlockRange, Commitment, Gap, IdGenerator, MishnaRef } from './types';

// ---------------------------------------------------------------------------
// Group
//
// A set of users whose blocks together cover the group's slice of the corpus.
// Owns its blocks, its gap queue (ranges vacated by dropouts), and the tail
// (the next never-yet-allocated mishna). All corpus traversal is delegated to
// the injected MishnaStructure.
//
// Allocation order: drain gaps front-to-back, then continue from the tail. A
// group is exhausted when the tail has run off the end and no gaps remain.
// ---------------------------------------------------------------------------

/** Serializable snapshot of a Group, for the persistence layer. */
export interface GroupState {
  id: string;
  /** Next mishna to allocate from the tail; null once the tail is exhausted. */
  tailRef: MishnaRef | null;
  blocks: Block[];
  gaps: Gap[];
}

export interface GroupInit {
  id: string;
  tailRef?: MishnaRef | null;
  blocks?: Block[];
  gaps?: Gap[];
}

export class Group {
  readonly id: string;
  private tailRef: MishnaRef | null;
  private blocks: Block[];
  private gaps: Gap[];

  constructor(
    private readonly structure: MishnaStructure,
    private readonly idGen: IdGenerator,
    init: GroupInit,
  ) {
    this.id = init.id;
    this.tailRef =
      init.tailRef === undefined ? structure.firstRef() : init.tailRef;
    this.blocks = init.blocks ?? [];
    this.gaps = init.gaps ?? [];
  }

  static fromState(
    structure: MishnaStructure,
    idGen: IdGenerator,
    state: GroupState,
  ): Group {
    return new Group(structure, idGen, state);
  }

  // -- public interface ------------------------------------------------------

  /**
   * Allocates up to `size` mishnayot to the user and returns how much was
   * actually allocated (less than `size` only when the group is exhausted).
   * Gaps are consumed front-to-back first, then the tail.
   */
  addUser(
    userId: string,
    size: number,
    commitment: Commitment,
  ): { allocated: number } {
    if (size < 1) {
      return { allocated: 0 };
    }

    const ranges: BlockRange[] = [];
    let remaining = size;

    // 1. drain gaps front-to-back
    let fromGap: BlockRange | null;
    while (remaining > 0 && (fromGap = this.useGap(remaining)) !== null) {
      ranges.push(fromGap);
      remaining -= this.structure.rangeSize(fromGap);
    }

    // 2. continue from the tail
    let fromTail: BlockRange | null;
    while (remaining > 0 && (fromTail = this.takeTail(remaining)) !== null) {
      ranges.push(fromTail);
      remaining -= this.structure.rangeSize(fromTail);
    }

    const allocated = size - remaining;
    if (allocated > 0) {
      const merged = this.mergeRanges(ranges);
      this.blocks.push({
        id: this.idGen(),
        userId,
        ranges: merged,
        totalSize: allocated,
        commitment,
      });
    }
    return { allocated };
  }

  /** Returns the user's block ranges to the gap queue and drops the block. */
  removeUser(userId: string): void {
    const idx = this.blocks.findIndex((b) => b.userId === userId);
    if (idx === -1) {
      return;
    }
    const [block] = this.blocks.splice(idx, 1);
    for (const range of block.ranges) {
      this.insertGap({
        id: this.idGen(),
        start: range.start,
        size: this.structure.rangeSize(range),
      });
    }
  }

  toState(): GroupState {
    return {
      id: this.id,
      tailRef: this.tailRef,
      blocks: this.blocks.map((b) => ({ ...b, ranges: [...b.ranges] })),
      gaps: this.gaps.map((g) => ({ ...g })),
    };
  }

  /** Whether the entire slice is allocated — tail run off the end, no gaps. */
  isExhausted(): boolean {
    return this.tailRef === null && this.gaps.length === 0;
  }

  /** Mishnayot still available to allocate: all gaps plus the remaining tail. */
  capacityLeft(): number {
    const gapTotal = this.gaps.reduce((sum, g) => sum + g.size, 0);
    const tailTotal =
      this.tailRef === null
        ? 0
        : this.structure.totalMishnayot - this.structure.indexOf(this.tailRef);
    return gapTotal + tailTotal;
  }

  // -- private ---------------------------------------------------------------

  /** Takes up to `size` from the front gap; null when no gaps remain. */
  private useGap(size: number): BlockRange | null {
    const gap = this.peekGap();
    if (gap === null) {
      return null;
    }
    const take = Math.min(gap.size, size);
    const range = this.structure.computeBlock(gap.start, take);
    if (take === gap.size) {
      this.consumeGap();
    } else {
      this.shrinkGap(take);
    }
    return range;
  }

  /** Takes up to `size` from the tail and advances it; null if exhausted. */
  private takeTail(size: number): BlockRange | null {
    if (this.tailRef === null) {
      return null;
    }
    const range = this.structure.computeBlock(this.tailRef, size);
    this.tailRef = this.structure.advance(range.end, 1);
    return range;
  }

  private peekGap(): Gap | null {
    return this.gaps[0] ?? null;
  }

  private consumeGap(): void {
    this.gaps.shift();
  }

  /** Advances the front gap's start by `size` and shrinks it. */
  private shrinkGap(size: number): void {
    const gap = this.gaps[0];
    const newStart = this.structure.advance(gap.start, size);
    if (newStart === null) {
      // Shrinking past the end leaves nothing; drop the gap.
      this.gaps.shift();
      return;
    }
    gap.start = newStart;
    gap.size -= size;
  }

  /** Inserts a gap in corpus order, merging with any contiguous neighbours. */
  private insertGap(gap: Gap): void {
    this.gaps.push(gap);
    this.gaps.sort(
      (a, b) =>
        this.structure.indexOf(a.start) - this.structure.indexOf(b.start),
    );
    this.gaps = this.mergeGaps(this.gaps);
  }

  private gapEndIndex(gap: Gap): number {
    return this.structure.indexOf(gap.start) + gap.size - 1;
  }

  /** Merges contiguous gaps in an already-sorted list. */
  private mergeGaps(sorted: Gap[]): Gap[] {
    const out: Gap[] = [];
    for (const gap of sorted) {
      const prev = out[out.length - 1];
      if (prev && this.structure.indexOf(gap.start) === this.gapEndIndex(prev) + 1) {
        prev.size += gap.size;
      } else {
        out.push({ ...gap });
      }
    }
    return out;
  }

  /** Merges contiguous ranges in an already-ordered list. */
  private mergeRanges(ordered: BlockRange[]): BlockRange[] {
    const out: BlockRange[] = [];
    for (const range of ordered) {
      const prev = out[out.length - 1];
      if (
        prev &&
        this.structure.indexOf(range.start) ===
          this.structure.indexOf(prev.end) + 1
      ) {
        prev.end = range.end;
      } else {
        out.push({ ...range });
      }
    }
    return out;
  }
}
