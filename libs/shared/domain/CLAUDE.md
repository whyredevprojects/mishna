# @mishna/domain

Framework-free core domain: corpus structure, group allocation, daily assignment,
and the Rosh-Chodesh-Sivan cycle calendar. No storage, no framework, fully unit-tested.
The design narrative lives in `README.md`; this file is the implementation map.

## Public surface (`src/index.ts`)

| Export | What it is |
|--------|------------|
| `MishnaStructure` | Static corpus model. `indexOf` / `refAt` / `firstRef` / `lastRef` / `advance` / `rangeSize` / `computeBlock` / `iterateRange`. The spine — all corpus traversal lives here. |
| `createMishnaStructure()` | Builds the default `MishnaStructure` from bundled `mishnah_dataset.json` (4192 mishnayot). |
| `CycleCalendar` | `cycleStart` / `cycleEnd` / `daysSinceCycleStart` / `daysRemaining`, via `@hebcal/core`. Cycle = 1 Sivan → next 1 Sivan. |
| `Group` | Per-group allocation: `addUser` / `removeUser`, plus `toState` / `fromState` for persistence. Owns blocks, the gap queue, and the tail. |
| `AssignmentEngine` | `getAssignment(blocks, date)` — streams the user's mishnayot and slices the day's portion. `getWeekAssignment(blocks, weekStart, days=7)` — concatenates the daily slices for a week (the email "quota"). Stateless. |
| Email scheduling (`email-schedule.ts`) | `EmailJob`/`EmailKind` (the `apps/server`→`apps/email` queue contract), and pure timezone helpers `localParts(instant, tz)`, `weekStartOnOrBefore(parts, dow)`, `weekStartToDate(weekStart)` (built on `Intl`, UTC-day math). |
| `GroupRepository` (port) + `InMemoryGroupRepository` | Persistence boundary. Production talks to D1; tests/local use the in-memory impl. |
| `GroupManager` | `join` / `removeUser` — orchestrates allocation across groups. |
| Types | `MishnaRef`, `BlockRange`, `Block`, `Gap`, `Commitment`, `Assignment`, `IdGenerator`, `GroupState`, `GroupInit`. |

## Key conventions

- **Corpus order** = dataset order: sedarim → masechtot → perakim → mishnayot. Every mishna has a stable 0-based global index.
- **`MishnaRef.mesechta`** is the English masechet name (unique across the corpus).
- **Purity / determinism:** ids come from an injected `IdGenerator`; "today" is always passed in. Nothing reads `Date.now()` or `crypto` internally.
- **Each group spans the whole corpus.** `GroupManager` creates additional groups when one fills, so the corpus is covered N times over by N groups.
- **Timezone safety:** `CycleCalendar` interprets every `Date` by its **UTC** calendar day and does all math on absolute day numbers — `new HDate(date)` reads *local* Y/M/D and would be off by a day on hosts behind UTC.

## Testing

`nx test domain`. Structure tests run against the real bundled corpus; allocation/assignment
tests use `tinyDataset` (10 mishnayot, hand-checkable boundaries) and helpers in
`src/lib/test-fixtures.ts` (`sequentialIdGen`, `fakeCalendar`, `makeBlock`, `blockIndices`).
`integration.spec.ts` asserts daily assignments tile the corpus with no overlap or gaps.

## Dependency note

`@hebcal/core` is declared in this lib's `package.json` **and** at the workspace root
(so Nx's project graph / `@nx/dependency-checks` lint resolves it). Keep both in sync.
