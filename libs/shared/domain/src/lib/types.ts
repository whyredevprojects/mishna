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

/** How many mishnas a user commits to learning per day. */
export type Commitment = 1 | 2 | 3;

/**
 * What a user is assigned within a single group. May be non-contiguous within
 * the group because it can be assembled from reclaimed gaps plus a tail range.
 * Always group-scoped — a user has at most one Block per group.
 */
export interface Block {
  id: string;
  userId: string;
  /** Ordered by corpus position; non-contiguous only when assembled from gaps + tail. */
  ranges: BlockRange[];
  /** Denormalized sum of mishnas across all ranges. */
  totalSize: number;
  commitment: Commitment;
}

/** A vacated range left behind by a dropout. `end` is derivable via MishnaStructure. */
export interface Gap {
  id: string;
  start: MishnaRef;
  size: number;
}

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
