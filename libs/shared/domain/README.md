# domain

This library was generated with [Nx](https://nx.dev).

## Building

Run `nx build domain` to build the library.

## Running unit tests

Run `nx test domain` to execute the unit tests via [Vitest](https://vitest.dev/).

# Mishna Allocation Design

## Models

### MishnaStructure

Static reference model. Knows the shape of the corpus — sedarim, mesechtos, perakim, and mishna counts. No runtime state, no storage access.

**Key method:**

```ts
computeBlock(start: MishnaRef, size: number): BlockRange
```

Pure function. Given a starting position and a mishna count, returns the range that covers exactly that many mishnas. All corpus traversal logic lives here (e.g. advancing past the end of a perek into the next one).

---

### MishnaRef

A pointer to a single mishna.

```ts
type MishnaRef = {
  mesechta: string
  perek: number
  mishna: number
}
```

---

### BlockRange

A contiguous range of mishnas.

```ts
type BlockRange = {
  start: MishnaRef
  end: MishnaRef
}
```

---

### Block

What a user is assigned within a single group. May be non-contiguous within the group due to gaps being filled. Always group-scoped — if a user's commitment exceeds what a group has available, they get multiple `Block`s, one per group.

```ts
type Block = {
  id: string
  userId: string
  ranges: BlockRange[]  // ordered; non-contiguous only when assembled from gaps + tail
  totalSize: number     // denormalized sum across all ranges
  commitment: Commitment
}
```

A user's full assignment for the cycle is the ordered union of their blocks across all groups, sorted by corpus position of each block's first range.

---

### Gap

A vacated range left by a dropout.

```ts
type Gap = {
  id: string
  start: MishnaRef
  size: number       // end is derivable via MishnaStructure
}
```

When a user drops out, each `BlockRange` in their block becomes a `Gap` and is re-inserted into the group in corpus order.

---

### Group

A set of users whose blocks together cover all assigned sedarim. Owns its blocks, gaps, and all allocation logic. A group is exhausted when its entire corpus is allocated — `tailRef` has reached the end and there are no gaps remaining.

```ts
class Group {
  id: string

  // public interface

  // allocates up to size for the user; returns how much was allocated
  // (may be less than size if group is exhausted — GroupManager handles the remainder)
  addUser(userId: string, size: number): { allocated: number }

  // returns the user's block ranges to the gap queue
  removeUser(userId: string): void

  // private
  private blocks: Block[]
  private tailRef: MishnaRef
  private gaps: Gap[]
  private useGap(size: number): BlockRange | null    // front gap, up to size
  private takeTail(size: number): BlockRange | null  // tail, up to size; null if exhausted
  private insertGap(gap: Gap): void                  // inserts in corpus order
  private peekGap(): Gap | null
  private consumeGap(): void
  private shrinkGap(size: number): void
  private isExhausted(): boolean
  private capacityLeft(): number
}
```

`addUser` drains gaps front-to-back via `useGap`, then continues from the tail via `takeTail`, assembles the resulting ranges into a `Block`, and owns it. `removeUser` finds the user's block, decomposes its ranges into gaps, and re-inserts them in corpus order. Both depend on `MishnaStructure` for corpus traversal — `Group` takes it as a constructor dependency.

The persistence layer is responsible for loading a `Group` fully into memory before use, and saving it afterward.

---

### Commitment

```ts
type Commitment = 1 | 2 | 3  // mishnas per day
```

---

### Assignment

What a user must learn on a specific date. Derived on demand — not pre-generated.

```ts
type Assignment = {
  userId: string
  date: Date
  mishnas: MishnaRef[]  // the specific mishnas for that day
}
```

---

## Services

### AssignmentEngine

Stateless. Given a user's blocks and a date, computes which mishnas are due.

```
getAssignment(blocks: Block[], date: Date):
  dayNumber = daysSinceCycleStart(date)          // 0-indexed
  mishnaOffset = dayNumber * blocks[0].commitment
  return flattenBlocks(blocks).slice(mishnaOffset, mishnaOffset + commitment)
```

`flattenBlocks` streams mishnas across all blocks in corpus order, then across ranges within each block, without materializing the full list.

---

### GroupManager

Orchestrates allocation across groups. Loops until the user's full commitment is satisfied, delegating to each group in turn. Responsible for loading and saving `Group` state around each call.

**Join algorithm:**

```
join(user, commitment, today):
  remaining = commitment * daysRemaining(today)

  while remaining > 0:
    group = loadNonExhaustedGroup() ?? createNewGroup()
    result = group.addUser(user.id, remaining)
    remaining -= result.allocated
    save(group)
```

If one group is exhausted mid-allocation, `GroupManager` moves to the next, creating one if needed. Block creation and ownership is entirely the group's concern.

**Concurrency:** the invariant being protected is `tailRef` integrity — two simultaneous joins must not allocate overlapping ranges from the same group. On D1 (SQLite), writes are serialized, so saving a mutated `Group` back to storage is sufficient. If two requests race, one will write first; the second will load the already-advanced `tailRef` and continue from there. No advisory locks or Durable Objects needed.

---

## Data flow: user joins

```
User joins
  → GroupManager.join(user, commitment, today)
      → loop until remaining == 0:
          → loads a non-exhausted Group or creates new Group
          → group.addUser(userId, remaining)
              → useGap() then takeTail() until satisfied or group exhausted
              → assembles and owns the Block internally
              → returns { allocated }
          → remaining -= allocated, saves Group
```

## Data flow: daily assignment

```
User opens app on a given date
  → load user's Blocks across all groups, ordered by corpus position
  → AssignmentEngine.getAssignment(blocks, date)
      → computes day offset from cycle start
      → streams mishnas across blocks and ranges in corpus order
      → returns Assignment (the specific mishnas for that day)
```

## Data flow: user drops out

```
User drops out
  → GroupManager.removeUser(user)
      → load user's Blocks (one per group)
      → for each Block:
          → load Group
          → group.removeUser(userId)
              → decomposes block ranges into Gaps
              → re-inserts each Gap in corpus order
          → save Group
```
