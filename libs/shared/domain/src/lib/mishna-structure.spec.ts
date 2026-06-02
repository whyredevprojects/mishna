import { MishnaStructure } from './mishna-structure';
import { createMishnaStructure } from './mishna-structure-factory';
import { tinyDataset } from './test-fixtures';
import { MishnaRef } from './types';

describe('MishnaStructure (real corpus)', () => {
  const structure = createMishnaStructure();

  it('contains the whole corpus', () => {
    expect(structure.totalMishnayot).toBe(4192);
  });

  it('round-trips indexOf <-> refAt at the edges and interior', () => {
    for (const i of [0, 1, 100, 2096, structure.totalMishnayot - 1]) {
      expect(structure.indexOf(structure.refAt(i))).toBe(i);
    }
  });

  it('first ref is Berakhot 1:1', () => {
    expect(structure.firstRef()).toEqual({
      mesechta: 'Berakhot',
      perek: 1,
      mishna: 1,
    });
    expect(structure.indexOf(structure.firstRef())).toBe(0);
  });

  it('last ref is the corpus end', () => {
    expect(structure.isLast(structure.lastRef())).toBe(true);
    expect(structure.indexOf(structure.lastRef())).toBe(4191);
  });
});

describe('MishnaStructure (tiny fixture)', () => {
  const s = new MishnaStructure(tinyDataset);
  const ref = (mesechta: string, perek: number, mishna: number): MishnaRef => ({
    mesechta,
    perek,
    mishna,
  });

  it('lays the corpus out in order', () => {
    expect(s.totalMishnayot).toBe(10);
    expect(s.refAt(0)).toEqual(ref('Aleph', 1, 1));
    expect(s.refAt(2)).toEqual(ref('Aleph', 2, 1));
    expect(s.refAt(5)).toEqual(ref('Bet', 1, 1));
    expect(s.refAt(9)).toEqual(ref('Bet', 2, 3));
  });

  it('computeBlock crosses a perek boundary', () => {
    // start Aleph 1:2 (index 1), size 2 -> ends Aleph 2:1 (index 2)
    expect(s.computeBlock(ref('Aleph', 1, 2), 2)).toEqual({
      start: ref('Aleph', 1, 2),
      end: ref('Aleph', 2, 1),
    });
  });

  it('computeBlock crosses a masechta boundary', () => {
    // start Aleph 2:3 (index 4), size 2 -> ends Bet 1:1 (index 5)
    expect(s.computeBlock(ref('Aleph', 2, 3), 2)).toEqual({
      start: ref('Aleph', 2, 3),
      end: ref('Bet', 1, 1),
    });
  });

  it('computeBlock clamps at the corpus end', () => {
    const block = s.computeBlock(ref('Bet', 2, 2), 10);
    expect(block.end).toEqual(ref('Bet', 2, 3));
    expect(s.rangeSize(block)).toBe(2);
  });

  it('computeBlock rejects non-positive sizes', () => {
    expect(() => s.computeBlock(ref('Aleph', 1, 1), 0)).toThrow();
  });

  it('advance returns null past the end', () => {
    expect(s.advance(ref('Bet', 2, 3), 1)).toBeNull();
    expect(s.advance(ref('Aleph', 1, 1), 9)).toEqual(ref('Bet', 2, 3));
  });

  it('iterateRange yields exactly rangeSize refs in order', () => {
    const range = { start: ref('Aleph', 2, 1), end: ref('Bet', 1, 2) };
    const refs = [...s.iterateRange(range)];
    expect(refs).toHaveLength(s.rangeSize(range));
    expect(refs[0]).toEqual(ref('Aleph', 2, 1));
    expect(refs[refs.length - 1]).toEqual(ref('Bet', 1, 2));
  });

  it('indexOf throws on an unknown ref', () => {
    expect(() => s.indexOf(ref('Nope', 1, 1))).toThrow();
  });
});
