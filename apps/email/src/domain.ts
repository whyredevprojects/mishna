import {
  AssignmentEngine,
  CycleCalendar,
  IdGenerator,
  MishnaStructure,
  createMishnaStructure,
} from '@mishna/domain';

// Domain singletons, built once per isolate (the corpus parse is not free). Mirror
// of apps/server/src/domain.ts — pure/static, so safe to share across invocations.
export const structure: MishnaStructure = createMishnaStructure();
export const calendar = new CycleCalendar();
export const assignmentEngine = new AssignmentEngine(structure, calendar);
export const idGen: IdGenerator = () => crypto.randomUUID();
