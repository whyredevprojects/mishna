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
    // The tractate JSONs are served from the app root at build time, but under
    // the Hebrew build they live beneath `/he/` (the localized deployUrl). A
    // root-absolute '' base would bypass the `/he/` service worker's scope, so
    // derive the base path from the document's <base href> ('' at root, '/he'
    // under Hebrew).
    const base = new URL(document.baseURI).pathname.replace(/\/$/, '');
    const tractate = await getTractate(base, ref.mesechta);
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
