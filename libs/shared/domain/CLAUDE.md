# @mishna/domain

Framework-free core domain: corpus structure, group allocation, weekly assignment,
and the Rosh-Chodesh-Sivan cycle calendar. No storage, no framework, fully unit-tested.
The design narrative lives in `README.md`; this file is the implementation map.

A user's `Commitment` (1/2/3) is their chosen weekly pace in mishnayot, **not** a lot
count. At signup they get random pre-set **lots (chalakim)** up to a *budget* of
`commitment × weeksRemaining(joinDate)` mishnayot — the manager keeps handing out lots
until the next one would push them over the budget, and always gives at least one lot. So
a joiner near the start of the cycle gets several lots; a late joiner gets fewer (down to
one). `computeJoinOptions` produces the signup choices, framing each pace by the
approximate lot count it works out to and collapsing the slower paces into a single
"1 lot" option near the cycle end. Each `Block` records its `startDate` (the join date).

Scheduling is anchored to that `startDate`, not the cycle start: a "week" is a 7-day
bucket counted from the user's join date, so their first week is the *start* of their lots
(no mid-cycle catch-up). `getAssignment` paces them at `ceil(totalSize / weeksRemaining)`
mishnayot/week so they finish their lots around the cycle end, slices at
`weeksSinceStart × pace`, and the slice is stable across all 7 days of a bucket. (A block
persisted before `startDate` existed falls back to the cycle start.) The email path anchors
its week to the user's chosen weekly-email weekday, so the dashboard's "this week" (bucket
for today) and the weekly email (bucket for the send day) can differ by a few days at
bucket boundaries; the next email re-syncs. (Open question — see root `TODO.md`.)

## Public surface (`src/index.ts`)

| Export | What it is |
|--------|------------|
| `MishnaStructure` | Static corpus model. `indexOf` / `refAt` / `firstRef` / `lastRef` / `advance` / `rangeSize` / `computeBlock` / `iterateRange`. The spine — all corpus traversal lives here. |
| `createMishnaStructure()` | Builds the default `MishnaStructure` from bundled `mishnah_dataset.json` (4192 mishnayot). |
| `MishnaChalakim` | The hand-authored "chelek" (lot) division: 118 sequential, contiguous `MishnaLot`s. `lotsForMesechta(nameEn)` (a mesechta may span several lots) / `getLotByNumber(1..118)` / `allLots()`. |
| `createMishnaChalakim()` | Builds the default `MishnaChalakim` from bundled `chaluka.json`. The factory holds the index-building logic; the constructor just stores the maps. |
| `CycleCalendar` | `cycleStart` / `cycleEnd` / `daysSinceCycleStart` / `daysRemaining` / `weeksSinceCycleStart` (floor days/7) / `weeksRemaining` (ceil days/7), via `@hebcal/core`. Cycle = 1 Sivan → next 1 Sivan. |
| `Group` | One full covering of the corpus, handed out as lots. `addUser(userId, commitment, startDate, budget, exclude, random, mustTakeAtLeastOne)` hands out random free lots up to `budget` mishnayot (excluding lot numbers the user already holds elsewhere), forcing one lot when `mustTakeAtLeastOne`, and reports why it stopped (`'budget'` vs `'groupFull'`); `removeUser` frees them; `toState`/`fromState` for persistence. A group's members' lots tile the corpus exactly once; it's exhausted when all lots are taken. Needs a `MishnaChalakim` (the lot universe). |
| `AssignmentEngine` | `getAssignment(blocks, date)` — streams the user's mishnayot and slices the week's portion, anchored to `blocks[0].startDate` (offset = `weeksSinceStart × pace`, `pace = ceil(totalSize / weeksRemaining(start))`). `getWeekAssignment(blocks, weekStart)` — the slice for the week bucket containing `weekStart` (the email "quota"); identical to `getAssignment`'s slice. Stateless. |
| `computeJoinOptions(structure, chalakim, calendar, date)` | The signup commitment choices (`JoinOption[]`) as of `date`: each pace annotated with its approximate lot count, collapsing the slower paces into a single "1 lot" option near the cycle end. Pure. |
| Email scheduling (`email-schedule.ts`) | `EmailJob`/`EmailKind` (the email job shape used by `apps/server`'s email path), and pure timezone helpers `localParts(instant, tz)`, `weekStartOnOrBefore(parts, dow)`, `weekStartToDate(weekStart)` (built on `Intl`, UTC-day math). |
| `GroupRepository` (port) + `InMemoryGroupRepository` | Persistence boundary. Production talks to D1; tests/local use the in-memory impl. |
| `GroupManager` | `join(userId, commitment, startDate)` / `removeUser` — claims a user's lots up to the `commitment × weeksRemaining(startDate)` budget (≥ one lot), spilling to the next group only if one runs out (carrying the lots already taken so a user never draws the same lot twice). Built with a `RandomSource` and a `CycleCalendar`. |
| Types | `MishnaRef`, `BlockRange`, `MishnaLot`, `Block` (carries `lots` + derived `ranges`/`totalSize`, plus `commitment` and `startDate`), `Commitment` (weekly pace), `JoinOption`, `RandomSource`, `Assignment`, `IdGenerator`, `GroupState`, `GroupInit`, `ChalukaEntry`. |

## Data build steps

The two bundled JSON artifacts are generated by one-shot tools in `bin/` and checked in:

- `bin/get-mishna-structure.ts` → `src/data/mishnah_dataset.json` (fetched from Sefaria).
- `bin/parse-chaluka.ts` → `src/data/chaluka.json` from the hand-authored
  `src/data/chaluka.csv` (`maseches code, Perek, chelek number`). It resolves each
  maseches code to its English `nameEn`, computes each lot's contiguous range, and
  validates the lots tile the whole corpus before writing. Run:
  `npx tsx libs/shared/domain/bin/parse-chaluka.ts`.

## Key conventions

- **Corpus order** = dataset order: sedarim → masechtot → perakim → mishnayot. Every mishna has a stable 0-based global index.
- **`MishnaRef.mesechta`** is the English masechet name (unique across the corpus).
- **Purity / determinism:** ids come from an injected `IdGenerator`, randomness from an injected `RandomSource`, and "today" is always passed in. Nothing reads `Date.now()`, `Math.random`, or `crypto` internally. (Tests pass `() => 0` to pick lots in corpus order.)
- **Each group is one full covering of the corpus** (its 118 lots tile it once). `GroupManager` creates additional groups when one fills, so the corpus is covered N times over by N groups.
- **Timezone safety:** `CycleCalendar` interprets every `Date` by its **UTC** calendar day and does all math on absolute day numbers — `new HDate(date)` reads *local* Y/M/D and would be off by a day on hosts behind UTC.

## Testing

`nx test domain`. Structure tests run against the real bundled corpus; allocation/assignment
tests use `tinyDataset` (10 mishnayot, hand-checkable boundaries) and helpers in
`src/lib/test-fixtures.ts` (`sequentialIdGen`, `fakeCalendar`, `makeBlock`, `blockIndices`,
`tinyChalakim` — 4 lots over the tiny corpus — and `pickInOrder`, a `RandomSource` that
takes the lowest-numbered free lots first). `integration.spec.ts` asserts a group's members'
lots tile the corpus with no overlap or gaps.

## Dependency note

`@hebcal/core` is declared in this lib's `package.json` **and** at the workspace root
(so Nx's project graph / `@nx/dependency-checks` lint resolves it). Keep both in sync.
