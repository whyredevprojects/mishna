// Public surface of the @mishna/email-data library.
//
// The "actual" / SQL side of email: the D1-backed implementation of
// @mishna/email-domain's EmailRepository port, plus the `chunked` helper its
// batched `IN (...)` reads use to stay under D1's bind-param ceiling.

export {
  D1EmailRepository,
  chunked,
} from './lib/d1-email-repository';
export type { D1EmailRepositoryDeps } from './lib/d1-email-repository';
