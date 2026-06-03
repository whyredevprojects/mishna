import { Injectable } from '@angular/core';
import { getTractate } from 'mishna-text/tractate-index';
import { MishnaRef } from '../models/api.types';

/** The Hebrew/English text of a single mishna, plus its tractate's Hebrew name. */
export interface MishnaText {
  hebrew: string;
  english: string;
  tractateHebrewName: string;
}

/**
 * Resolves the text of a single mishna from the `mishna-text` package, which
 * fetches and caches whole tractates internally. This thin wrapper just narrows
 * a tractate down to the one ref the UI needs.
 */
@Injectable({ providedIn: 'root' })
export class MishnaTextService {
  /** The text for one mishna, or `null` if the ref isn't found. */
  async lookup(ref: MishnaRef): Promise<MishnaText | null> {
    const tractate = await getTractate('', ref.mesechta);
    const perek = tractate.perakim.find((p) => p.perek === ref.perek);
    const mishna = perek?.mishnayot.find((m) => m.mishna === ref.mishna);
    if (!mishna) {
      return null;
    }
    return {
      hebrew: mishna.hebrew,
      english: mishna.english,
      tractateHebrewName: tractate.hebrewName,
    };
  }
}
