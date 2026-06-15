import { computeJoinOptions } from './join-options';
import { createMishnaChalakim } from './mishna-chalakim';
import { MishnaStructure } from './mishna-structure';
import { createMishnaStructure } from './mishna-structure-factory';
import { cycleDay, fakeCalendar, tinyChalakim, tinyDataset } from './test-fixtures';

// tiny corpus: 10 mishnayot, 4 lots (sizes 2,3,2,3) -> avgLotSize 2.5, maxLot 3.

describe('computeJoinOptions', () => {
  const structure = new MishnaStructure(tinyDataset);
  const chalakim = tinyChalakim();

  it('offers three lot-annotated options early in the cycle', () => {
    // 10 weeks remaining: committed = 10/20/30 mishnayot -> ~4/8/12 lots.
    const calendar = fakeCalendar({ cycleLengthDays: 70 });
    const options = computeJoinOptions(structure, chalakim, calendar, cycleDay(0));
    expect(options.map((o) => o.commitment)).toEqual([1, 2, 3]);
    expect(options.every((o) => !o.singleLot)).toBe(true);
    expect(options[0].approxLots).toBe(4); // round(10 / 2.5)
    expect(options[1].approxLots).toBe(8); // round(20 / 2.5)
  });

  it('collapses the slowest pace to a single lot near the cycle end', () => {
    // 2 weeks remaining: 1/week -> 2 < avg 2.5 (single lot); 2/week -> 4 >= avg.
    const calendar = fakeCalendar({ cycleLengthDays: 14 });
    const options = computeJoinOptions(structure, chalakim, calendar, cycleDay(0));
    const one = options.find((o) => o.commitment === 1);
    expect(one?.singleLot).toBe(true);
    expect(one?.maxMishnas).toBe(3); // largest lot
    expect(one?.perDay).toBe(1); // ceil(3 / 14 days)
    expect(options.find((o) => o.commitment === 2)?.singleLot).toBe(false);
  });

  it('drops the faster paces once they too would be a single lot', () => {
    // Real corpus (avg lot ~35) with one week left: every pace is under a lot,
    // so only the single "1 lot" option survives.
    const realStructure = createMishnaStructure();
    const realChalakim = createMishnaChalakim();
    const calendar = fakeCalendar({ cycleLengthDays: 7 });
    const options = computeJoinOptions(
      realStructure,
      realChalakim,
      calendar,
      cycleDay(0),
    );
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      commitment: 1,
      singleLot: true,
      approxLots: 1,
    });
    expect(options[0].maxMishnas).toBeGreaterThan(0);
    expect(options[0].perDay).toBeGreaterThan(0);
  });
});
