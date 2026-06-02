import { MishnahDataset } from './mishna-types';
import { BlockRange, MishnaRef } from './types';

// ---------------------------------------------------------------------------
// MishnaStructure
//
// Static reference model. Knows the shape of the corpus — sedarim, masechtot,
// perakim, and mishna counts — and owns all corpus traversal. No runtime state,
// no storage access. Pure functions throughout.
//
// "Corpus order" is dataset order: sedarim -> masechtot -> perakim (1..n) ->
// mishnayot (1..count). Every mishna has a stable 0-based global index.
// ---------------------------------------------------------------------------

function refKey(ref: MishnaRef): string {
  return `${ref.mesechta}|${ref.perek}|${ref.mishna}`;
}

export class MishnaStructure {
  /** Flat corpus in order; `refs[i]` is the mishna at global index `i`. */
  private readonly refs: MishnaRef[] = [];
  /** Reverse lookup: refKey -> global index. */
  private readonly index = new Map<string, number>();

  constructor(dataset: MishnahDataset) {
    for (const seder of dataset.sedarim) {
      for (const masechet of seder.masechtot) {
        for (const perek of masechet.perakim) {
          for (let mishna = 1; mishna <= perek.mishnayotCount; mishna++) {
            const ref: MishnaRef = {
              mesechta: masechet.nameEn,
              perek: perek.perekNumber,
              mishna,
            };
            this.index.set(refKey(ref), this.refs.length);
            this.refs.push(ref);
          }
        }
      }
    }

    if (this.refs.length === 0) {
      throw new Error('MishnaStructure: dataset contains no mishnayot');
    }
  }

  /** Total number of mishnayot in the corpus. */
  get totalMishnayot(): number {
    return this.refs.length;
  }

  /** 0-based global index of a ref. Throws if the ref is not in the corpus. */
  indexOf(ref: MishnaRef): number {
    const i = this.index.get(refKey(ref));
    if (i === undefined) {
      throw new Error(
        `MishnaStructure: unknown ref ${ref.mesechta} ${ref.perek}:${ref.mishna}`,
      );
    }
    return i;
  }

  /** Ref at a 0-based global index. Throws if out of range. */
  refAt(index: number): MishnaRef {
    const ref = this.refs[index];
    if (ref === undefined) {
      throw new Error(`MishnaStructure: index ${index} out of range`);
    }
    return ref;
  }

  /** First mishna in the corpus. */
  firstRef(): MishnaRef {
    return this.refs[0];
  }

  /** Last mishna in the corpus. */
  lastRef(): MishnaRef {
    return this.refs[this.refs.length - 1];
  }

  /** Whether a ref is the final mishna of the corpus. */
  isLast(ref: MishnaRef): boolean {
    return this.indexOf(ref) === this.refs.length - 1;
  }

  /**
   * The ref `n` mishnayot after `ref` (n=0 returns `ref`). Returns null if it
   * would advance past the end of the corpus.
   */
  advance(ref: MishnaRef, n: number): MishnaRef | null {
    const target = this.indexOf(ref) + n;
    if (target < 0 || target >= this.refs.length) {
      return null;
    }
    return this.refs[target];
  }

  /** Number of mishnayot in a range, inclusive of both endpoints. */
  rangeSize(range: BlockRange): number {
    return this.indexOf(range.end) - this.indexOf(range.start) + 1;
  }

  /**
   * The range covering exactly `size` mishnayot starting at `start`. If `size`
   * would overrun the corpus the range is clamped to the last mishna, so the
   * caller learns the real size via `rangeSize`.
   */
  computeBlock(start: MishnaRef, size: number): BlockRange {
    if (size < 1) {
      throw new Error(`MishnaStructure: size must be >= 1, got ${size}`);
    }
    const startIdx = this.indexOf(start);
    const endIdx = Math.min(startIdx + size - 1, this.refs.length - 1);
    return { start, end: this.refs[endIdx] };
  }

  /** Streams the refs in a range in corpus order, without materializing a list. */
  *iterateRange(range: BlockRange): Iterable<MishnaRef> {
    const endIdx = this.indexOf(range.end);
    for (let i = this.indexOf(range.start); i <= endIdx; i++) {
      yield this.refs[i];
    }
  }
}
