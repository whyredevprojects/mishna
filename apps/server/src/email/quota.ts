import { Block, MishnaRef } from '@mishna/domain';
import { getTractate } from 'mishna-text/tractate-index';
import { assignmentEngine } from '../domain';

export interface ResolvedMishna {
  ref: MishnaRef;
  tractateHebrew: string;
  hebrew: string;
}

/**
 * The user's next still-unlearned bucket — the same "current mishnayos" the
 * dashboard shows (progress-based, not the calendar week). `date` only stamps the
 * result; it never selects the bucket, so the email's send date is fine to pass.
 */
export function nextRefs(
  blocks: Block[],
  completed: MishnaRef[],
  date: Date,
): MishnaRef[] {
  return assignmentEngine.getNextAssignment(blocks, completed, date).mishnas;
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
