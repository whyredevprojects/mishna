// Public surface of the @mishna/email-data library.
//
// The "actual" / SQL side of email: the D1-backed implementation of
// @mishna/email-domain's EmailRepository port, plus the `chunked` helper shared
// with the app's other batched readers.

export {
  D1EmailRepository,
  chunked,
} from './lib/d1-email-repository';
export type { D1EmailRepositoryDeps } from './lib/d1-email-repository';
