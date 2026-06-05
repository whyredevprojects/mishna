import { CycleCalendar } from './cycle-calendar';
import { MishnaStructure } from './mishna-structure';
import { Assignment, Block, MishnaRef } from './types';

// ---------------------------------------------------------------------------
// AssignmentEngine
//
// Stateless. Given a user's blocks (their full assignment for the cycle) and a
// date, computes which mishnayot are due that week. Nothing is pre-generated:
// the week's mishnayot are the slice of the user's flattened corpus at the
// offset implied by how many weeks into the cycle we are. The slice is stable
// across all 7 days of a week bucket and advances once per week.
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
    const commitment = blocks[0].commitment;
    const week = this.calendar.weeksSinceCycleStart(date);

    // Before the cycle starts there is nothing to learn.
    if (week < 0) {
      return { userId, date, mishnas: [] };
    }

    const offset = week * commitment;
    const ordered = this.orderBlocks(blocks);
    const mishnas = this.take(ordered, offset, commitment);
    return { userId, date, mishnas };
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
