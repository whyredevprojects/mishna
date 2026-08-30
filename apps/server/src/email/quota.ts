import { MishnaRef } from '@mishna/domain';
import { ResolvedMishna, TextResolver } from '@mishna/email-domain';
import { getTractate } from 'mishna-text/tractate-index';

// The production `TextResolver`: the one piece of the email content path that does
// I/O. The port itself (`TextResolver`/`ResolvedMishna`) lives in
// `@mishna/email-domain` — this file is only the HTTP implementation of it.

/** What `getTractate` hands back: one tractate's full Hebrew text. */
type Tractate = Awaited<ReturnType<typeof getTractate>>;

/**
 * Fetch one tractate's JSON by its English name. Injected into
 * {@link httpTextResolver} so the caching and the failure behavior below are
 * unit-testable without a network (and so local tooling can point at a file).
 */
export type TractateLoader = (
  base: string,
  englishName: string,
) => Promise<Tractate>;

/**
 * The production resolver: fetches each tractate's text once from `base` (the
 * origin serving mishna-text's `data/*.json`, i.e. APP_ORIGIN) and caches it.
 * The cache lives on the resolver, not the call, so every job in a batch shares it
 * — a batch where 100 users all need the same tractate fetches it once, not 100×.
 * `getTractate` keys on the English masechet name, which equals `MishnaRef.mesechta`.
 *
 * **Degrades per ref; never throws.** `getTractate` throws on a name it doesn't know
 * (and on a network failure), and this resolver is called from inside a
 * `send-batch-N` workflow step: a single bad tractate name would fail that whole
 * step, take 99 innocent recipients down with it, and retry forever. So a failed
 * tractate is logged once as a structured `console.error` (with the name, which is
 * what an operator needs to fix it — e.g. after a `mishna-text` bump renames a
 * file) and its refs render with `hebrew: ''`: the recipient still gets their email,
 * with the reference and a missing body, instead of no email at all.
 */
export function httpTextResolver(
  base: string,
  loadTractate: TractateLoader = getTractate,
): TextResolver {
  // `null` is a remembered failure: one console.error and one attempt per tractate
  // per batch, not one per ref.
  const cache = new Map<string, Tractate | null>();
  return async (refs: MishnaRef[]) => {
    const out: ResolvedMishna[] = [];
    for (const ref of refs) {
      if (!cache.has(ref.mesechta)) {
        try {
          cache.set(ref.mesechta, await loadTractate(base, ref.mesechta));
        } catch (err) {
          cache.set(ref.mesechta, null);
          console.error(
            JSON.stringify({
              evt: 'tractate_load_failed',
              tractate: ref.mesechta,
              base,
              detail: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }
      const tractate = cache.get(ref.mesechta) ?? null;
      const perek = tractate?.perakim.find((p) => p.perek === ref.perek);
      const mishna = perek?.mishnayot.find((m) => m.mishna === ref.mishna);
      out.push({
        ref,
        tractateHebrew: tractate?.hebrewName ?? '',
        hebrew: mishna?.hebrew ?? '',
      });
    }
    return out;
  };
}
