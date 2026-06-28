import { GroupState } from './group';
import { Block } from './types';

// ---------------------------------------------------------------------------
// blocksForUser — the single source of truth for "which blocks belong to a user".
//
// A group's persisted state carries *every* member's blocks (a group is one full
// covering of the corpus). So any code that wants one user's portion MUST filter the
// group's blocks to that user — otherwise it sees the whole group. That rule used to
// be hand-rolled at every data-loading site; one copy diverged and paced a user over
// the whole group's ~4192-mishna covering instead of their own lots. This is the one
// place the rule lives now; the web and email paths both route through it.
// ---------------------------------------------------------------------------

/**
 * The blocks `userId` holds, flattened across the given group states. Pure: the
 * caller loads the raw group states (a persisted `groups.state` is exactly a
 * serialized `GroupState`, so `JSON.parse` yields one directly) and the domain
 * decides which are this user's.
 */
export function blocksForUser(states: GroupState[], userId: string): Block[] {
  return states.flatMap((s) => s.blocks.filter((b) => b.userId === userId));
}
