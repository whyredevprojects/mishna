// Public surface of the @mishna/email-data library.
//
// The "actual" / SQL side of email: the D1-backed implementation of
// @mishna/email-domain's EmailRepository port, plus the generic `chunked` /
// `placeholders` D1 paging helpers (reused by apps/server's admin readers) that
// keep batched `IN (...)` reads under D1's bind-param ceiling.

export {
  D1EmailRepository,
  chunked,
  placeholders,
} from './lib/d1-email-repository';
export type { D1EmailRepositoryDeps } from './lib/d1-email-repository';
