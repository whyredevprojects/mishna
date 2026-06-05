import { Block, MishnaRef, weekStartToDate } from '@mishna/domain';
import { getTractate } from 'mishna-text/tractate-index';
import { assignmentEngine } from '../domain';

export interface ResolvedMishna {
  ref: MishnaRef;
  tractateHebrew: string;
  hebrew: string;
}

/** The mishnayot for the cycle-week containing `weekStart` (the user's weekly quota). */
export function weekRefs(blocks: Block[], weekStart: string): MishnaRef[] {
  return assignmentEngine.getWeekAssignment(blocks, weekStartToDate(weekStart));
}

/** A function that yields the Hebrew text for a set of refs. Injectable so the
 *  consumer can be tested without the network. */
export type TextResolver = (refs: MishnaRef[]) => Promise<ResolvedMishna[]>;

/**
 * The production resolver: fetches each tractate's text once from `base` (the
 * origin serving mishna-text's `data/*.json`, i.e. APP_ORIGIN) and caches it.
 * The cache lives on the resolver, not the call, so every job in a batch shares it
 * — a batch where 100 users all need the same tractate fetches it once, not 100×.
 * `getTractate` keys on the English masechet name, which equals `MishnaRef.mesechta`.
 */
export function httpTextResolver(base: string): TextResolver {
  const cache = new Map<string, Awaited<ReturnType<typeof getTractate>>>();
  return async (refs) => {
    const out: ResolvedMishna[] = [];
    for (const ref of refs) {
      let tractate = cache.get(ref.mesechta);
      if (!tractate) {
        tractate = await getTractate(base, ref.mesechta);
        cache.set(ref.mesechta, tractate);
      }
      const perek = tractate.perakim.find((p) => p.perek === ref.perek);
      const mishna = perek?.mishnayot.find((m) => m.mishna === ref.mishna);
      out.push({
        ref,
        tractateHebrew: tractate.hebrewName,
        hebrew: mishna?.hebrew ?? '',
      });
    }
    return out;
  };
}
