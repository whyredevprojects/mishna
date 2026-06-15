import { CycleCalendar } from './cycle-calendar';
import { GroupRepository } from './group-repository';
import { Commitment, RandomSource } from './types';

// ---------------------------------------------------------------------------
// GroupManager
//
// Orchestrates lot allocation across groups. A user gets random lots up to a
// budget of mishnayot — their weekly pace (`commitment`) times the weeks left in
// the cycle from their join date — so a later joiner gets fewer lots, and never
// fewer than one. The lots normally all come from one group, but if a group runs
// out mid-join the remainder comes from the next group (or a fresh one), and
// join() carries the lots already taken so a user never gets the same lot twice
// across groups. Each mutated group is saved back through the repository.
//
// Concurrency: the invariant is that two lots are never handed to two users at
// once. On D1 writes are serialized (the AllocatorDO), so saving the mutated
// group is sufficient — a racing join reloads the already-claimed lots and picks
// from what's left. No locks needed.
// ---------------------------------------------------------------------------

export class GroupManager {
  constructor(
    private readonly repo: GroupRepository,
    private readonly random: RandomSource,
    private readonly calendar: CycleCalendar,
  ) {}

  /**
   * Joins a user for the current cycle as of `startDate` (ISO yyyy-mm-dd),
   * assigning them random lots up to a budget of `commitment * weeksRemaining`
   * mishnayot (at least one lot), spread across as many groups as needed (almost
   * always one).
   */
  async join(
    userId: string,
    commitment: Commitment,
    startDate: string,
  ): Promise<void> {
    let remaining = commitment * this.calendar.weeksRemaining(new Date(startDate));
    const taken: number[] = [];
    let tookAny = false;

    for (;;) {
      const group =
        (await this.repo.loadNonExhaustedGroup()) ??
        (await this.repo.createGroup());
      // Seed the consecutive run from the last lot already taken, so the chain
      // continues even when a join spills into another group.
      const after = taken.length ? taken[taken.length - 1] : undefined;
      const { allocated, lots, mishnayot, stopped } = group.addUser(
        userId,
        commitment,
        startDate,
        remaining,
        taken,
        this.random,
        !tookAny,
        after,
      );
      await this.repo.save(group);
      taken.push(...lots);
      remaining -= mishnayot;
      if (allocated > 0) {
        tookAny = true;
      }

      // Budget exhausted, or the group gave nothing (it had no free lots and we
      // already hold at least one lot) — done. Otherwise the group filled up
      // mid-budget, so spill into the next group.
      if (stopped === 'budget' || allocated === 0) {
        break;
      }
    }
  }

  /** Removes a user from every group, freeing their lots. */
  async removeUser(userId: string): Promise<void> {
    const groups = await this.repo.loadGroupsForUser(userId);
    for (const group of groups) {
      group.removeUser(userId);
      await this.repo.save(group);
    }
  }
}
