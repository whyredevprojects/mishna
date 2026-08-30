/**
 * RFC 8058 one-click unsubscribe — **moved** to `@mishna/email-domain`.
 *
 * The token (`unsubscribe-token.ts`) and the landing page (`unsubscribe-page.ts`) are
 * pure functions over `crypto.subtle` and string building, with no clock, no storage
 * and no Cloudflare binding, so they now live in the domain lib and are covered by
 * sub-second plain-node unit tests instead of a workerd integration run. The *routes*
 * that use them, and the D1 upsert they drive, stay in `src/index.ts` — that half is
 * SQL (including the `DEFAULT 1` insert-branch trap) and needs a real D1 either way.
 *
 * This file is kept as a re-export shim so existing import paths (`./email/unsubscribe`)
 * keep working; prefer importing from `@mishna/email-domain` in new code.
 */

export type {
  UnsubscribeScope,
  UnsubscribeClaims,
  UnsubscribeLang,
} from '@mishna/email-domain';
export {
  mintUnsubscribeToken,
  verifyUnsubscribeToken,
  parseClaims,
  unsubscribeUrl,
  pickLang,
  confirmPageHtml,
  donePageHtml,
  errorPageHtml,
  plainDone,
  plainError,
} from '@mishna/email-domain';
