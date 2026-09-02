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
 * unsubscribe and "memorized" URLs across lines and make them unclickable.
 */
async function build(
  subject: string,
  element: ReactElement,
): Promise<BuiltEmail> {
  const html = await render(element);
  return { subject, html, text: toPlainText(html) };
}

/** The links and origin a rendered email needs, beyond its content. */
export interface RenderOptions {
  appOrigin: string;
  /**
   * The recipient's signed one-click unsubscribe link — the footer's visible
   * "Unsubscribe" (the matching RFC 8058 headers are set in `sender.ts`).
   */
  unsubscribeUrl?: string;
  /**
   * The recipient's signed "I've memorized this" link — the prominent CTA at the top.
   * Ignored on the empty state, which has nothing to have memorized.
   */
  memorizedUrl?: string;
}

/** The weekly quota email: every mishna due this coming week, with its text. */
export async function weeklyEmail(
  items: ResolvedMishna[],
  opts: RenderOptions,
): Promise<BuiltEmail> {
  return build(
    WEEKLY_TITLE,
    <WeeklyEmail
      items={items}
      appOrigin={opts.appOrigin}
      unsubscribeUrl={opts.unsubscribeUrl}
      memorizedUrl={opts.memorizedUrl}
    />,
  );
}

/** The reminder email: only the mishnayot still not marked learned this week. */
export async function reminderEmail(
  pending: ResolvedMishna[],
  opts: RenderOptions,
): Promise<BuiltEmail> {
  return build(
    REMINDER_TITLE,
    <ReminderEmail
      pending={pending}
      appOrigin={opts.appOrigin}
      unsubscribeUrl={opts.unsubscribeUrl}
      memorizedUrl={opts.memorizedUrl}
    />,
  );
}
