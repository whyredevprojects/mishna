import { CycleCalendar } from './cycle-calendar';
import { MishnaStructure } from './mishna-structure';
import { Assignment, Block, MishnaRef } from './types';

// ---------------------------------------------------------------------------
// AssignmentEngine
//
// Stateless. Given a user's blocks (their full assignment for the cycle) and a
// date, computes which mishnayot are due that day. Nothing is pre-generated:
// the day's mishnayot are the slice of the user's flattened corpus at the
// offset implied by how many days into the cycle we are.
// ---------------------------------------------------------------------------

export class AssignmentEngine {
  constructor(
    private readonly structure: MishnaStructure,
    private readonly calendar: CycleCalendar,
  ) {}

  /** The mishnayot the user must learn on `date`. */
  getAssignment(blocks: Block[], date: Date): Assignment {
    if (blocks.length === 0) {
      return { userId: '', date, mishnas: [] };
    }

    const userId = blocks[0].userId;
    const commitment = blocks[0].commitment;
    const day = this.calendar.daysSinceCycleStart(date);

    // Before the cycle starts there is nothing to learn.
    if (day < 0) {
      return { userId, date, mishnas: [] };
    }

    const offset = day * commitment;
    const ordered = this.orderBlocks(blocks);
    const mishnas = this.take(ordered, offset, commitment);
    return { userId, date, mishnas };
  }

  /**
   * Every mishna due across `days` consecutive days starting at `weekStart`
   * (inclusive). The per-day slices never overlap, so this is their concatenation
   * in corpus order — the "quota" for a week, used by the email reminders.
   */
  getWeekAssignment(blocks: Block[], weekStart: Date, days = 7): MishnaRef[] {
    const out: MishnaRef[] = [];
    for (let d = 0; d < days; d++) {
      const date = new Date(weekStart.getTime() + d * 86_400_000);
      out.push(...this.getAssignment(blocks, date).mishnas);
    }
    return out;
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
