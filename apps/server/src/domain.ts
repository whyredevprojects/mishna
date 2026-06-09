import {
  AssignmentEngine,
  CycleCalendar,
  IdGenerator,
  MishnaChalakim,
  MishnaStructure,
  RandomSource,
  createMishnaChalakim,
  createMishnaStructure,
} from '@mishna/domain';

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
