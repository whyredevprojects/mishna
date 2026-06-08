import dataset from '../data/mishnah_dataset.json';
import { MishnahDataset } from './mishna-types';
import { MishnaStructure } from './mishna-structure';

/** The bundled corpus dataset (4192 mishnayot), for callers that need the raw hierarchy. */
export const mishnahDataset = dataset as MishnahDataset;

/** Builds the default MishnaStructure from the bundled corpus dataset. */
export function createMishnaStructure(): MishnaStructure {
  return new MishnaStructure(mishnahDataset);
}
