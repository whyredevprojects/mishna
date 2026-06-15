import { CycleCalendar } from './cycle-calendar';
import { MishnaChalakim } from './mishna-chalakim';
import { MishnaStructure } from './mishna-structure';
import { Commitment, JoinOption } from './types';

// ---------------------------------------------------------------------------
// computeJoinOptions
//
// The signup commitment choices, framed in mishnayot per week but annotated with
// roughly how many lots each pace works out to from a given date to the end of
// the cycle. As the cycle progresses the lot counts shrink, and near the end the
// options collapse: a person can never get fewer than one lot, so once a pace
// works out to less than a lot it becomes a single "1 lot" option, and the
// higher paces that would also be a single lot are dropped as redundant.
//
// Pure: every input is injected, so the result is deterministic for a date.
// ---------------------------------------------------------------------------

const COMMITMENTS: Commitment[] = [1, 2, 3];

export function computeJoinOptions(
  structure: MishnaStructure,
  chalakim: MishnaChalakim,
  calendar: CycleCalendar,
  date: Date,
): JoinOption[] {
  const lots = chalakim.allLots();
  const sizes = lots.map((l) => structure.rangeSize(l.range));
  const avgLotSize = structure.totalMishnayot / lots.length;
  const maxLotSize = Math.max(...sizes);

  const weeksRemaining = Math.max(1, calendar.weeksRemaining(date));
  const daysRemaining = Math.max(1, calendar.daysRemaining(date));

  const options: JoinOption[] = [];
  for (const commitment of COMMITMENTS) {
    const committed = commitment * weeksRemaining;
    const singleLot = committed < avgLotSize;

    // A higher pace that still works out to less than a lot is the same single
    // lot as commitment 1 — drop it rather than offer a duplicate "1 lot".
    if (singleLot && commitment !== 1) {
      continue;
    }

    if (singleLot) {
      options.push({
        commitment,
        approxLots: 1,
        singleLot: true,
        maxMishnas: maxLotSize,
        perDay: Math.ceil(maxLotSize / daysRemaining),
      });
    } else {
      options.push({
        commitment,
        approxLots: Math.max(1, Math.round(committed / avgLotSize)),
        singleLot: false,
      });
    }
  }

  return options;
}
