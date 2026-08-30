import { ReactElement } from 'react';
import { render, toPlainText } from '@react-email/render';
import { ResolvedMishna } from '@mishna/email-domain';
import { ReminderEmail, REMINDER_TITLE } from './reminder-email';
import { WeeklyEmail, WEEKLY_TITLE } from './weekly-email';

// React Email templates, one component per file under `./`. Each email is a
// React component rendered to email-safe HTML (inline styles) at send time via
// `render`. English chrome; the mishna text itself stays Hebrew (RTL). See the
// individual *.tsx files to edit a template.
//
// `render` picks its renderer from the runtime's export condition: `workerd` →
// `renderToReadableStream`, `node` → `renderToPipeableStream`. Both emit the same
// static markup for these templates, but that isn't a contract — so this lib's tests
// assert semantics (the labels, the Hebrew body, the footer, the text part's shape)
// and apps/server's workerd integration test keeps the byte-level guarantees.

export interface BuiltEmail {
  subject: string;
  html: string;
  /**
   * The `text/plain` half of the `multipart/alternative` message Resend assembles
   * when it gets both parts. A single-part HTML email is a spam-filter signal and is
   * unreadable in text-only clients, so every template ships both.
   */
  text: string;
}

/**
 * Render one email to its HTML **and** text parts.
 *
 * The text is derived from the very HTML being sent (`toPlainText`, which is
 * html-to-text under the hood) rather than from a second `render(el, { plainText:
 * true })`: a second render doubles the React CPU per email inside a Workflow step
 * that may be handling 100 of them, and deriving from the sent HTML means the two
 * parts cannot say different things. Both are pure, so `sender.ts`'s deterministic
 * `Idempotency-Key` contract holds either way.
 *
 * Two behaviors this leans on: react-email's default `plainTextSelectors` skip the
 * `<Preview>` preheader (so its 150-char zero-width-space padding never leaks into
 * the text part), and `toPlainText` hard-sets `wordwrap: false` — load-bearing,
 * since html-to-text's default 80-column wrap would break the long base64url
 * unsubscribe URL across lines and make it unclickable.
 */
async function build(
  subject: string,
  element: ReactElement,
): Promise<BuiltEmail> {
  const html = await render(element);
  return { subject, html, text: toPlainText(html) };
}

/**
 * The weekly quota email: every mishna due this coming week, with its text.
 * `unsubscribeUrl` is the recipient's signed one-click link — it renders as the
 * footer's visible "Unsubscribe" link (the matching RFC 8058 headers are set in
 * `sender.ts`).
 */
export async function weeklyEmail(
  items: ResolvedMishna[],
  appOrigin: string,
  unsubscribeUrl?: string,
): Promise<BuiltEmail> {
  return build(
    WEEKLY_TITLE,
    <WeeklyEmail
      items={items}
      appOrigin={appOrigin}
      unsubscribeUrl={unsubscribeUrl}
    />,
  );
}

/** The reminder email: only the mishnayot still not marked learned this week. */
export async function reminderEmail(
  pending: ResolvedMishna[],
  appOrigin: string,
  unsubscribeUrl?: string,
): Promise<BuiltEmail> {
  return build(
    REMINDER_TITLE,
    <ReminderEmail
      pending={pending}
      appOrigin={appOrigin}
      unsubscribeUrl={unsubscribeUrl}
    />,
  );
}
