// Public surface of the @mishna/email-domain library.
//
// The abstract email business logic: who gets which email, when, and with what
// content — pure, framework-free, over an injected EmailRepository port and an
// AssignmentSource (satisfied by @mishna/domain's AssignmentEngine). The D1
// adapter for the port lives in @mishna/email-data.

export type {
  EmailKind,
  EmailPrefs,
  Candidate,
  Candidacy,
  PreparedEmail,
  ResolvedData,
  AssignmentSource,
} from './lib/types';
export { DEFAULT_EMAIL_PREFS } from './lib/types';
export type {
  EmailRepository,
  InMemoryEmailData,
} from './lib/email-repository';
export { InMemoryEmailRepository } from './lib/email-repository';
export {
  SEND_HOUR,
  refKey,
  refsForKind,
  sentKey,
  selectDue,
  dropAlreadySent,
  buildPreparedEmails,
  planSends,
} from './lib/plan-sends';
