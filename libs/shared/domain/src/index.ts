// Public surface of the @mishna/domain library.

export * from './lib/mishna-types';
export * from './lib/types';
export { MishnaStructure } from './lib/mishna-structure';
export { createMishnaStructure, mishnahDataset } from './lib/mishna-structure-factory';
export { MishnaChalakim, createMishnaChalakim, chalukaData } from './lib/mishna-chalakim';
export type { ChalukaEntry } from './lib/mishna-chalakim';
export { CycleCalendar } from './lib/cycle-calendar';
export { Group } from './lib/group';
export type { GroupState, GroupInit } from './lib/group';
export { AssignmentEngine } from './lib/assignment-engine';
export type { GroupRepository } from './lib/group-repository';
export { InMemoryGroupRepository } from './lib/group-repository';
export { GroupManager } from './lib/group-manager';
export { computeJoinOptions } from './lib/join-options';
export { blocksForUser } from './lib/block-projection';
export {
  localParts,
  weekStartOnOrBefore,
  weekStartToDate,
} from './lib/email-schedule';
export type { EmailKind, EmailJob, LocalParts } from './lib/email-schedule';
