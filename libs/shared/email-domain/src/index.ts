// Public surface of the @mishna/email-domain library.
//
// The abstract email business logic: who gets which email, when, with what content,
// and the pure rules the send path leans on (prefs defaults, the unsubscribe token +
// landing page, the outgoing-email shape and its idempotency/header contracts).
// Framework-free and storage-free, over an injected EmailRepository port and an
// AssignmentSource (satisfied by @mishna/domain's AssignmentEngine). The D1 adapter
// for the port lives in @mishna/email-data; the React Email rendering lives in
// @mishna/email-templates; the Resend + D1 side effects live in apps/server.

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

// -- content (what goes in one email) ---------------------------------------
export type {
  ResolvedMishna,
  TextResolver,
  SingleSendInput,
  PrepareOptions,
} from './lib/content';
export { resolveOne, prepareSingle } from './lib/content';

// -- the outgoing message ---------------------------------------------------
export type { OutgoingEmail, EmailTransport } from './lib/outgoing';
export {
  batchIdempotencyKey,
  listId,
  unsubscribeHeaders,
} from './lib/outgoing';

// -- prefs rules ------------------------------------------------------------
export type { UnsubscribeVia, EmailPrefsRow } from './lib/prefs-rules';
export {
  mergePrefs,
  flagsAfterUnsubscribe,
  unsubscribeAudit,
  isHardUnsubscribe,
} from './lib/prefs-rules';

// -- one-click unsubscribe (token + landing page) ---------------------------
export type {
  UnsubscribeScope,
  UnsubscribeClaims,
  UnsubscribeLang,
} from './lib/unsubscribe-token';
export {
  mintUnsubscribeToken,
  verifyUnsubscribeToken,
  parseClaims,
  unsubscribeUrl,
} from './lib/unsubscribe-token';
export {
  COPY,
  pickLang,
  escapeHtml,
  settingsUrl,
  page,
  confirmPageHtml,
  donePageHtml,
  errorPageHtml,
  plainDone,
  plainError,
} from './lib/unsubscribe-page';
