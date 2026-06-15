import { CycleCalendar } from './cycle-calendar';
import { MishnaStructure } from './mishna-structure';
import { Assignment, Block, MishnaRef } from './types';

// ---------------------------------------------------------------------------
// AssignmentEngine
//
// Stateless. Given a user's blocks (their full assignment for the cycle) and a
// date, computes which mishnayot are due that week. Nothing is pre-generated:
// the week's mishnayot are the slice of the user's flattened corpus at the
// offset implied by how many weeks have passed since the user joined. Weeks are
// counted from each block's `startDate` (not the cycle start), so the user's
// first week is the start of their lots — no mid-cycle catch-up. The pace is
// sized to finish their lots by the cycle end. The slice is stable across all 7
// days of a week bucket and advances once per week.
// ---------------------------------------------------------------------------

export class AssignmentEngine {
  constructor(
    private readonly structure: MishnaStructure,
    private readonly calendar: CycleCalendar,
  ) {}

  /** The mishnayot the user must learn in the week containing `date`. */
  getAssignment(blocks: Block[], date: Date): Assignment {
    if (blocks.length === 0) {
      return { userId: '', date, mishnas: [] };
    }

    const userId = blocks[0].userId;
    const start = blocks[0].startDate
      ? new Date(blocks[0].startDate)
      : this.calendar.cycleStart(date);

    // Weeks elapsed since the user joined (0 on their join week). Both day counts
    // are measured from the same cycle start, so the difference is start-relative.
    const week = Math.floor(
      (this.calendar.daysSinceCycleStart(date) -
        this.calendar.daysSinceCycleStart(start)) /
        7,
    );

    // Before the user's start week there is nothing to learn.
    if (week < 0) {
      return { userId, date, mishnas: [] };
    }

    const pace = this.pace(blocks, start);
    const offset = week * pace;
    const ordered = this.orderBlocks(blocks);
    const mishnas = this.take(ordered, offset, pace);
    return { userId, date, mishnas };
  }

  /**
   * Weekly pace: the user's whole portion spread evenly over the weeks left in
   * the cycle from their start, so they finish right around the cycle end. For a
   * normal signup this is at most their chosen commitment (the allocation budget
   * caps the portion at commitment * weeks); for a single oversized lot taken
   * near the cycle end it is the faster pace needed to still finish in time.
   */
  private pace(blocks: Block[], start: Date): number {
    const totalSize = blocks.reduce((sum, b) => sum + b.totalSize, 0);
    const weeks = Math.max(1, this.calendar.weeksRemaining(start));
    return Math.max(1, Math.ceil(totalSize / weeks));
  }

  /**
   * The mishnayot for the week bucket containing `weekStart` — the user's quota
   * for that week, used by the email reminders. Identical to `getAssignment`'s
   * slice; kept as a named entry point for the email path's intent.
   */
  getWeekAssignment(blocks: Block[], weekStart: Date): MishnaRef[] {
    return this.getAssignment(blocks, weekStart).mishnas;
  }

  /** Blocks sorted by the corpus position of their first range. */
  private orderBlocks(blocks: Block[]): Block[] {
    return [...blocks].sort(
      (a, b) =>
        this.structure.indexOf(a.ranges[0].start) -
        this.structure.indexOf(b.ranges[0].start),
    );
  }

  /** Streams the user's mishnayot, skips `offset`, returns up to `count`. */
  private take(blocks: Block[], offset: number, count: number): MishnaRef[] {
    const out: MishnaRef[] = [];
    let skip = offset;
    for (const block of blocks) {
      for (const range of block.ranges) {
        for (const ref of this.structure.iterateRange(range)) {
          if (skip > 0) {
            skip--;
            continue;
          }
          out.push(ref);
          if (out.length === count) {
            return out;
          }
        }
      }
    }
    return out;
  }
}
