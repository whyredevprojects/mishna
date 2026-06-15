import chaluka from '../data/chaluka.json';
import { BlockRange, MishnaLot } from './types';

// ---------------------------------------------------------------------------
// MishnaChalakim
//
// Serves the hand-authored "chelek" (lot) division of the corpus: 120 sequential
// lots, each a contiguous range of mishnayot. A mesechta may be split across
// several lots; a lot never crosses a mesechta boundary.
//
// The flat artifact (chaluka.json) is shaped into lookup maps by the factory
// `createMishnaChalakim`; the constructor just holds the prebuilt indexes.
// ---------------------------------------------------------------------------

/** One row of the bundled chaluka.json artifact. */
export interface ChalukaEntry {
  lot: number;
  mesechta: string;
  range: BlockRange;
}

export class MishnaChalakim {
  constructor(
    /** mesechta nameEn -> its lots, in corpus order. */
    private readonly byMesechta: ReadonlyMap<string, MishnaLot[]>,
    /** lot number -> the lot. */
    private readonly byLot: ReadonlyMap<number, MishnaLot>,
  ) {}

  /**
   * All lots a mesechta is divided into, by its English `nameEn`
   * (`MishnaRef.mesechta`), in corpus order. Throws if the name is unknown.
   */
  lotsForMesechta(nameEn: string): MishnaLot[] {
    const lots = this.byMesechta.get(nameEn);
    if (lots === undefined) {
      throw new Error(`MishnaChalakim: unknown mesechta ${nameEn}`);
    }
    return lots;
  }

  /**
   * The lot with the given lot number. Lot numbers are 1-indexed (1..120).
   * Throws if out of range.
   */
  getLotByNumber(lotNumber: number): MishnaLot {
    const lot = this.byLot.get(lotNumber);
    if (lot === undefined) {
      throw new Error(`MishnaChalakim: unknown lot number ${lotNumber}`);
    }
    return lot;
  }

  /** Every lot in corpus order. */
  allLots(): MishnaLot[] {
    return [...this.byLot.values()];
  }

  /** Every lot number (1..120) in corpus order. */
  allLotNumbers(): number[] {
    return [...this.byLot.keys()];
  }
}

/** The raw bundled chaluka artifact, for callers that want the flat list. */
export const chalukaData = chaluka as ChalukaEntry[];

/** Builds the default MishnaChalakim from the bundled chaluka.json. */
export function createMishnaChalakim(): MishnaChalakim {
  const byMesechta = new Map<string, MishnaLot[]>();
  const byLot = new Map<number, MishnaLot>();

  for (const entry of chalukaData) {
    const lot: MishnaLot = { lot: entry.lot, range: entry.range };
    byLot.set(entry.lot, lot);

    const existing = byMesechta.get(entry.mesechta) ?? [];
    existing.push(lot);
    byMesechta.set(entry.mesechta, existing);
  }

  return new MishnaChalakim(byMesechta, byLot);
}
