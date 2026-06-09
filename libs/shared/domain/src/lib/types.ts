// ---------------------------------------------------------------------------
// Domain value types
//
// Framework-free building blocks shared across the domain. See README.md for
// the full design narrative.
// ---------------------------------------------------------------------------

/** A pointer to a single mishna in the corpus. `mesechta` is the English name. */
export interface MishnaRef {
  mesechta: string;
  perek: number;
  mishna: number;
}

/** A contiguous range of mishnas, inclusive of both endpoints. */
export interface BlockRange {
  start: MishnaRef;
  end: MishnaRef;
}

/** One "chelek" (lot): a contiguous slice of the corpus and its lot number. */
export interface MishnaLot {
  /** 1-based chelek number from chaluka.csv (1..118), in corpus order. */
  lot: number;
  /** The contiguous range of mishnayot this lot covers. */
  range: BlockRange;
}

/**
 * A user's commitment for the cycle: the number of random lots (chalakim) they
 * are assigned, which is also their weekly pace in mishnayot. So `3` means three
 * random lots and three mishnayot learned per week. A user finishes when their
 * lots run out, which is generally before the cycle ends.
 */
export type Commitment = 1 | 2 | 3;

/**
 * What a user is assigned within a single group: a set of pre-set lots
 * (chalakim). The lots are scattered across the corpus, so `ranges` is
 * non-contiguous — one contiguous range per lot, ordered by corpus position.
 * `ranges` and `totalSize` are derived from `lots`. Always group-scoped — a user
 * has at most one Block per group.
 */
export interface Block {
  id: string;
  userId: string;
  /** The lot numbers (1..118) this user holds in the group, ascending (= corpus order). */
  lots: number[];
  /** Each held lot's range, ordered by corpus position. Derived from `lots`. */
  ranges: BlockRange[];
  /** Denormalized sum of mishnas across all ranges. */
  totalSize: number;
  commitment: Commitment;
}

/**
 * Injected source of randomness in [0, 1), like `Math.random`. Injected (not
 * read internally) so lot selection stays deterministic under test, the same
 * discipline as `IdGenerator`.
 */
export type RandomSource = () => number;

/** What a user must learn on a specific date. Derived on demand, never stored. */
export interface Assignment {
  userId: string;
  date: Date;
  mishnas: MishnaRef[];
}

/**
 * Injected source of unique ids. Defaults to `crypto.randomUUID` in production;
 * tests pass a deterministic generator.
 */
export type IdGenerator = () => string;
