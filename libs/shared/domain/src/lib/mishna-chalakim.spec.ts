import { createMishnaChalakim } from './mishna-chalakim';
import { createMishnaStructure } from './mishna-structure-factory';

describe('MishnaChalakim', () => {
  const chalakim = createMishnaChalakim();
  const structure = createMishnaStructure();

  it('has 118 lots numbered 1..118 in corpus order', () => {
    const lots = chalakim.allLots();
    expect(lots).toHaveLength(118);
    expect(lots.map((l) => l.lot)).toEqual(
      Array.from({ length: 118 }, (_, i) => i + 1),
    );
  });

  it('tiles the whole corpus with no gaps or overlap', () => {
    const lots = chalakim.allLots();

    expect(structure.indexOf(lots[0].range.start)).toBe(0);
    expect(structure.isLast(lots[lots.length - 1].range.end)).toBe(true);

    let prevEndIdx = -1;
    let covered = 0;
    for (const { range } of lots) {
      expect(structure.indexOf(range.start)).toBe(prevEndIdx + 1);
      prevEndIdx = structure.indexOf(range.end);
      covered += structure.rangeSize(range);
    }
    expect(covered).toBe(structure.totalMishnayot);
  });

  describe('lotsForMesechta', () => {
    it('returns all lots a mesechta is split into, in order', () => {
      const lots = chalakim.lotsForMesechta('Berakhot');
      expect(lots.map((l) => l.lot)).toEqual([1, 2]);
      expect(lots[0].range.start).toEqual({
        mesechta: 'Berakhot',
        perek: 1,
        mishna: 1,
      });
      expect(structure.indexOf(lots[1].range.end)).toBe(
        structure.indexOf(lots[0].range.end) +
          structure.rangeSize(lots[1].range),
      );
    });

    it('throws on an unknown mesechta', () => {
      expect(() => chalakim.lotsForMesechta('Nope')).toThrow();
    });
  });

  describe('getLotByNumber', () => {
    it('returns the lot for a 1-indexed lot number', () => {
      expect(structure.indexOf(chalakim.getLotByNumber(1).range.start)).toBe(0);
      expect(structure.isLast(chalakim.getLotByNumber(118).range.end)).toBe(true);
    });

    it('throws on out-of-range lot numbers', () => {
      expect(() => chalakim.getLotByNumber(0)).toThrow();
      expect(() => chalakim.getLotByNumber(119)).toThrow();
    });
  });
});
