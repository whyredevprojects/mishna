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
  /** 1-based chelek number from chaluka.csv (1..120), in corpus order. */
  lot: number;
  /** The contiguous range of mishnayot this lot covers. */
  range: BlockRange;
}

/**
 * A user's chosen weekly pace in mishnayot: `2` means "two mishnayot a week". It
 * is no longer the lot count — the number of lots is derived at allocation from
 * the pace times the weeks left in the cycle (the "budget"), so a joiner later in
 * the cycle gets fewer lots. A user finishes when their lots run out, which is by
 * design around the end of the cycle.
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
  /** The lot numbers (1..120) this user holds in the group, ascending (= corpus order). */
  lots: number[];
  /** Each held lot's range, ordered by corpus position. Derived from `lots`. */
  ranges: BlockRange[];
  /** Denormalized sum of mishnas across all ranges. */
  totalSize: number;
  commitment: Commitment;
  /**
   * ISO date (yyyy-mm-dd) the user joined and this block was allocated. The
   * assignment engine schedules relative to it, so the user's first week is the
   * start of their lots — no mid-cycle catch-up. Optional for backward
   * compatibility with blocks persisted before this field existed; the engine
   * falls back to the cycle start when it's absent.
   */
  startDate?: string;
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

/**
 * One commitment choice offered at signup, framed in mishnayot per week but
 * annotated with how many lots it works out to from today to the end of the
 * cycle. Computed by `computeJoinOptions`; carries numbers only, each client
 * formats its own copy.
 */
export interface JoinOption {
  /** The weekly pace this option commits to (also the value POSTed on join). */
  commitment: Commitment;
  /** Approximate number of lots committed to, based on average lot size (>= 1). */
  approxLots: number;
  /**
   * True near the cycle end, when this pace works out to less than one lot, so
   * the user is guaranteed a single lot instead. `maxMishnas` and `perDay` are
   * set only in this case.
   */
  singleLot: boolean;
  /** When `singleLot`: the largest a single lot can be (upper bound). */
  maxMishnas?: number;
  /** When `singleLot`: mishnayot per day to finish that lot by the cycle end. */
  perDay?: number;
}
