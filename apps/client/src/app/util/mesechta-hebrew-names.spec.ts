import { mishnahDataset } from '@mishna/domain';
import { MESECHTA_HEBREW_NAMES } from './mesechta-hebrew-names';

describe('MESECHTA_HEBREW_NAMES', () => {
  const datasetPairs = mishnahDataset.sedarim.flatMap((seder) =>
    seder.masechtot.map((m) => [m.nameEn, m.nameHe] as const),
  );

  it('maps every mesechta nameEn to its dataset nameHe', () => {
    for (const [nameEn, nameHe] of datasetPairs) {
      expect(MESECHTA_HEBREW_NAMES[nameEn]).toBe(nameHe);
    }
  });

  it('covers exactly the dataset mesechtos (no extras, no gaps)', () => {
    const datasetNames = new Set(datasetPairs.map(([nameEn]) => nameEn));
    const mapKeys = Object.keys(MESECHTA_HEBREW_NAMES);
    expect(mapKeys.length).toBe(datasetNames.size);
    for (const key of mapKeys) {
      expect(datasetNames.has(key)).toBe(true);
    }
  });
});
