import { GroupRepository } from './group-repository';
import { Commitment, RandomSource } from './types';

// ---------------------------------------------------------------------------
// GroupManager
//
// Orchestrates lot allocation across groups. A user takes `commitment` random
// lots. They normally all fit in one group, but if a group runs out of lots
// mid-join, the remainder comes from the next group (or a fresh one) — and join()
// carries the lots already taken so a user never gets the same lot twice across
// groups. Each mutated group is saved back through the repository.
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
  ) {}

  /**
   * Joins a user for the current cycle, assigning them `commitment` random lots,
   * spread across as many groups as needed (almost always one).
   */
  async join(userId: string, commitment: Commitment): Promise<void> {
    let remaining = commitment;
    const taken: number[] = [];

    while (remaining > 0) {
      const group =
        (await this.repo.loadNonExhaustedGroup()) ??
        (await this.repo.createGroup());
      // Seed the chain from the last lot already taken, so consecutive assignment
      // continues even when a join spills into another group.
      const after = taken.length ? taken[taken.length - 1] : undefined;
      const { allocated, lots } = group.addUser(
        userId,
        remaining,
        commitment,
        taken,
        this.random,
        after,
      );
      await this.repo.save(group);
      taken.push(...lots);
      remaining -= allocated;

      // A non-exhausted or fresh group always allocates > 0; guard regardless
      // so a misbehaving repository can never spin this loop forever.
      if (allocated === 0) {
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
