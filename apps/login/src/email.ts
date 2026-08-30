import { Resend } from 'resend';

// Transactional auth emails (verification + password reset) sent via Resend.
// Self-contained in the login worker — it has its own RESEND_API_KEY secret and
// RESEND_FROM_EMAIL var, so it never has to call back into apps/server. apps/server
// owns the bulk reminder/weekly mail on the same verified sender domain (the single
// source of truth is `config/domains.json`); these are one-off `resend.emails.send`,
// not the batch path.
//
// English, inline-styled HTML (email clients strip <style>/external CSS). better-auth
// hands us a ready-to-click `url` (verify-email / reset-password endpoint + token).
//
// These deliberately carry **no** List-Unsubscribe / one-click unsubscribe headers,
// unlike apps/server's scheduled weekly/reminder mail. These are transactional: a
// user cannot meaningfully "unsubscribe" from the verification or password-reset
// email they just asked for, and offering it would break account recovery.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** The two bodies of one email: the HTML part and its `text/plain` alternative. */
export interface EmailBody {
  html: string;
  text: string;
}

/**
 * A simple branded shell: heading, a line of intro text, and a CTA button — in both
 * parts. Resend sends a `multipart/alternative` when it gets `html` **and** `text`; an
 * HTML-only message is a spam-filter signal and unreadable in a text-only client, which
 * for *these* two emails means a user who can't verify their address or reset their
 * password. The text half is hand-written from the same four arguments rather than
 * derived from the HTML: this worker has no `@react-email/*` dependency (only
 * better-auth, kysely, resend) and pulling a renderer in for two hardcoded strings isn't
 * worth the bundle. Keep the two in sync by hand when editing.
 *
 * `escapeHtml` applies to the HTML part only — escaping the text part would put a
 * literal `&amp;` in front of the user.
 *
 * Exported for `email.test.ts` (constructing `Resend` happens in `send`, so importing
 * this module has no side effects).
 */
export function shell(
  heading: string,
  intro: string,
  buttonLabel: string,
  url: string,
): EmailBody {
  return {
    html: `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
  <body style="margin:0;background:#f5f3ee;font-family:Georgia,'Times New Roman',serif;">
    <div style="max-width:560px;margin:0 auto;padding:24px;">
      <h1 style="font-size:22px;color:#1a1a1a;margin:0 0 16px;">${escapeHtml(heading)}</h1>
      <p style="color:#444;line-height:1.6;margin:0 0 20px;">${escapeHtml(intro)}</p>
      <a href="${url}"
         style="display:inline-block;background:#7a5c00;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;">
        ${escapeHtml(buttonLabel)}
      </a>
      <hr style="border:none;border-top:1px solid #ddd;margin:28px 0 16px;" />
      <p style="color:#888;font-size:13px;line-height:1.6;margin:0;">
        If the button doesn't work, copy and paste this link into your browser:<br />
        <a href="${url}" style="color:#7a5c00;word-break:break-all;">${escapeHtml(url)}</a>
      </p>
    </div>
  </body>
</html>`,
    // The URL sits alone on its own line: a mail client that auto-links plain text
    // needs the whole thing unbroken, and a user copy-pasting must not pick up
    // surrounding prose.
    text: `${heading}

${intro}

${buttonLabel}:
${url}`,
  };
}

/** The message these two emails hand to the transport. Resend's `emails.send` shape. */
export interface OutgoingMessage {
  from: string;
  replyTo: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * The transport seam: sends one message and reports a provider-level failure in the
 * result (Resend's `{ data, error }` convention) rather than by throwing.
 *
 * Injectable so `sendVerificationEmail` / `sendResetPasswordEmail` are testable
 * end-to-end — subject, recipient, `from`/`replyTo` from env, both parts present, and
 * the *absence* of any `List-Unsubscribe*` header — without a network or an API key.
 * Omit it in production and the Resend client is constructed at call time (its
 * constructor throws without a key, which is what keeps importing this module
 * side-effect-free).
 */
export type SendFn = (
  msg: OutgoingMessage,
) => Promise<{ error?: { message: string } | null }>;

/** Sends one transactional email; throws on a Resend error so callers can await it. */
async function send(
  env: Env,
  to: string,
  subject: string,
  body: EmailBody,
  sendFn?: SendFn,
): Promise<void> {
  const msg: OutgoingMessage = {
    from: env.RESEND_FROM_EMAIL,
    replyTo: env.RESEND_REPLY_TO_EMAIL,
    to,
    subject,
    ...body,
  };
  // No `headers` on either message, deliberately — see the note at the top of this
  // file. These are transactional; a List-Unsubscribe on account recovery is wrong.
  const { error } = await (sendFn
    ? sendFn(msg)
    : new Resend(env.RESEND_API_KEY).emails.send(msg));
  if (error) {
    throw new Error(`Resend send failed: ${error.message}`);
  }
}

/** Email-confirmation on sign-up. `url` verifies the address then redirects back. */
export function sendVerificationEmail(
  env: Env,
  { to, url }: { to: string; url: string },
  sendFn?: SendFn,
): Promise<void> {
  return send(
    env,
    to,
    'Verify your email address',
    shell(
      'Verify your email',
      'Welcome to Chevras Mishnayos Baal Peh! Confirm your email address to finish setting up your account.',
      'Verify email',
      url,
    ),
    sendFn,
  );
}

/** Password-reset link. `url` opens the reset-password page with the token. */
export function sendResetPasswordEmail(
  env: Env,
  { to, url }: { to: string; url: string },
  sendFn?: SendFn,
): Promise<void> {
  return send(
    env,
    to,
    'Reset your password',
    shell(
      'Reset your password',
      'We received a request to reset your Chevras Mishnayos Baal Peh password. Click below to choose a new one. If you didn’t request this, you can safely ignore this email.',
      'Reset password',
      url,
    ),
    sendFn,
  );
}
