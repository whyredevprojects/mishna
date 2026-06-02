import dataset from './mishnah_dataset.json';
import { MishnahDataset } from './mishna-types';
import { MishnaStructure } from './mishna-structure';

/** Builds the default MishnaStructure from the bundled corpus dataset. */
export function createMishnaStructure(): MishnaStructure {
  return new MishnaStructure(dataset as MishnahDataset);
}
