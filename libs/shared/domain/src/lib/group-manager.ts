import { CycleCalendar } from './cycle-calendar';
import { GroupRepository } from './group-repository';
import { Commitment } from './types';

// ---------------------------------------------------------------------------
// GroupManager
//
// Orchestrates allocation across groups. A user's full commitment may not fit
// in a single group, so join() loops — filling one group, moving to (or
// creating) the next — until the whole commitment is placed. Each mutated group
// is saved back through the repository.
//
// Concurrency: the protected invariant is tail integrity. On D1 writes are
// serialized, so saving the mutated group is sufficient — a racing join reloads
// the already-advanced tail and continues from there. No locks needed.
// ---------------------------------------------------------------------------

export class GroupManager {
  constructor(
    private readonly repo: GroupRepository,
    private readonly calendar: CycleCalendar,
  ) {}

  /**
   * Joins a user for the current cycle. Their total allocation is
   * `commitment * weeksRemaining`, spread across as many groups as needed.
   */
  async join(userId: string, commitment: Commitment, today: Date): Promise<void> {
    let remaining = commitment * this.calendar.weeksRemaining(today);

    while (remaining > 0) {
      const group =
        (await this.repo.loadNonExhaustedGroup()) ??
        (await this.repo.createGroup());
      const { allocated } = group.addUser(userId, remaining, commitment);
      await this.repo.save(group);
      remaining -= allocated;

      // A non-exhausted or fresh group always allocates > 0; guard regardless
      // so a misbehaving repository can never spin this loop forever.
      if (allocated === 0) {
        break;
      }
    }
  }

  /** Removes a user from every group, returning their ranges as gaps. */
  async removeUser(userId: string): Promise<void> {
    const groups = await this.repo.loadGroupsForUser(userId);
    for (const group of groups) {
      group.removeUser(userId);
      await this.repo.save(group);
    }
  }
}
