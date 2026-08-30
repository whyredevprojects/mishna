import {
  AssignmentEngine,
  CycleCalendar,
  IdGenerator,
  MishnaChalakim,
  MishnaRef,
  MishnaStructure,
  RandomSource,
  createMishnaChalakim,
  createMishnaStructure,
} from '@mishna/domain';
import { AssignmentSource } from '@mishna/email-domain';

// ---------------------------------------------------------------------------
// Domain singletons
//
// Everything here is pure/static, so it is built once per worker isolate and
// shared across requests. The MishnaStructure parses the bundled 4192-mishna
// corpus; rebuilding it per request would be wasteful.
//
// Determinism is preserved at the edges: ids come from `idGen`, and "today" is
// always passed into the domain by the routes (never read inside the domain).
// ---------------------------------------------------------------------------

export const structure: MishnaStructure = createMishnaStructure();
export const chalakim: MishnaChalakim = createMishnaChalakim();
export const calendar = new CycleCalendar();
export const assignmentEngine = new AssignmentEngine(structure, calendar);
export const idGen: IdGenerator = () => crypto.randomUUID();
export const random: RandomSource = () => Math.random();

/**
 * The same engine, seen through the narrow port the email path actually needs
 * (`getNextAssignment`). `src/email/` depends on **this** binding rather than on the
 * concrete `assignmentEngine`, so nothing in the email module is coupled to
 * `AssignmentEngine`'s full surface and every email function that *decides* content
 * takes its engine as a parameter (see `email/sender.ts`'s `prepareOne`). Same
 * instance — the corpus is parsed once per isolate.
 */
export const emailContentEngine: AssignmentSource = assignmentEngine;

/**
 * One entry in the static lot catalog: a lot's number, its mesechta and 1-based
 * index within that mesechta (so the admin UI can render `54 (Peah:1)`), the
 * mishnayot it spans, and its size.
 */
export interface LotCatalogEntry {
  lot: number;
  mesechta: string;
  /** 1-based position of this lot among its mesechta's lots, in corpus order. */
  indexInMesechta: number;
  /** Display label `mesechta:indexInMesechta`, e.g. `Peah:1`. */
  label: string;
  start: MishnaRef;
  end: MishnaRef;
  size: number;
}

/**
 * The 120 lots as a flat catalog, built once per isolate. `allLots()` is in corpus
 * order, so a running per-mesechta counter yields each lot's index within its
 * mesechta. Served as-is by `GET /api/admin/lots` (the edit UI's reference list).
 */
export const lotCatalog: LotCatalogEntry[] = (() => {
  const counters = new Map<string, number>();
  return chalakim.allLots().map((l) => {
    const mesechta = l.range.start.mesechta;
    const indexInMesechta = (counters.get(mesechta) ?? 0) + 1;
    counters.set(mesechta, indexInMesechta);
    return {
      lot: l.lot,
      mesechta,
      indexInMesechta,
      label: `${mesechta}:${indexInMesechta}`,
      start: l.range.start,
      end: l.range.end,
      size: structure.rangeSize(l.range),
    };
  });
})();
