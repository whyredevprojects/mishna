import { describe, expect, it, vi } from 'vitest';
import {
  OutgoingMessage,
  SendFn,
  sendResetPasswordEmail,
  sendVerificationEmail,
  shell,
} from './email';

// The two transactional emails. `send()` constructs `Resend` only when no `sendFn` is
// injected, so importing this module is side-effect-free and these tests need no
// binding, no API key and no network.

const URL_WITH_QUERY =
  'https://app.mishna2go.com/api/auth/verify-email?token=abc.def&callbackURL=%2Fdashboard';

const ENV = {
  RESEND_FROM_EMAIL: 'Chevras Mishnayos Baal Peh <noreply@mishna2go.com>',
  RESEND_REPLY_TO_EMAIL: 'Chevras Mishnayos Baal Peh <support@mishna2go.com>',
} as unknown as Env;

/** A `SendFn` that records the message and reports success. */
function recorder(result: { error?: { message: string } } = {}) {
  const sent: OutgoingMessage[] = [];
  const sendFn: SendFn = async (msg) => {
    sent.push(msg);
    return result;
  };
  return { sendFn, sent };
}

describe('transactional email bodies', () => {
  it('ships a plain-text part alongside the HTML one', () => {
    // Resend sends a multipart/alternative only when it gets both; HTML-only mail is
    // a spam-filter signal, and these two emails are account recovery.
    const body = shell('Verify your email', 'Confirm to finish.', 'Verify email', URL_WITH_QUERY);
    expect(body.html).not.toBe('');
    expect(body.text).not.toBe('');
  });

  it('puts the URL bare on its own line in the text part', () => {
    // A mail client auto-linking plain text needs the whole URL unbroken, and a user
    // copy-pasting must not pick up the surrounding prose.
    const { text } = shell('Reset your password', 'Choose a new one.', 'Reset password', URL_WITH_QUERY);
    expect(text.split('\n')).toContain(URL_WITH_QUERY);
    // ...and the label sits on the line above, not wrapped around it.
    expect(text).toContain(`Reset password:\n${URL_WITH_QUERY}`);
  });

  it('carries no markup and no HTML escaping in the text part', () => {
    // escapeHtml is for the HTML half only — a literal `&amp;` in the URL's query
    // string would hand the user a link that doesn't work.
    const { text } = shell(
      'Verify your email',
      'Welcome & confirm your address to finish setting up your account.',
      'Verify email',
      URL_WITH_QUERY,
    );
    expect(text).not.toContain('<');
    expect(text).not.toContain('&amp;');
    expect(text).toContain('Welcome & confirm');
  });

  it('keeps the clickable link in the HTML part', () => {
    const { html } = shell('Verify your email', 'Confirm.', 'Verify email', URL_WITH_QUERY);
    expect(html).toContain(`href="${URL_WITH_QUERY}"`);
    expect(html).toContain('<!doctype html>');
  });
});

describe('sendVerificationEmail', () => {
  it('sends the right message to the right address, from the env sender', async () => {
    const { sendFn, sent } = recorder();
    await sendVerificationEmail(ENV, { to: 'a@example.com', url: URL_WITH_QUERY }, sendFn);

    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('Verify your email address');
    expect(sent[0].to).toBe('a@example.com');
    expect(sent[0].from).toBe(ENV.RESEND_FROM_EMAIL);
    expect(sent[0].replyTo).toBe(ENV.RESEND_REPLY_TO_EMAIL);
    expect(sent[0].html).not.toBe('');
    expect(sent[0].text).not.toBe('');
    // The link the whole email exists for reaches both parts.
    expect(sent[0].html).toContain(URL_WITH_QUERY);
    expect(sent[0].text).toContain(URL_WITH_QUERY);
  });

  it('rejects with the provider message when Resend reports an error', async () => {
    // better-auth awaits this callback; swallowing the failure would leave a user
    // stuck with no verification email and no error anywhere.
    const { sendFn } = recorder({ error: { message: 'domain not verified' } });
    await expect(
      sendVerificationEmail(ENV, { to: 'a@example.com', url: URL_WITH_QUERY }, sendFn),
    ).rejects.toThrow(/domain not verified/);
  });
});

describe('sendResetPasswordEmail', () => {
  it('sends the right message to the right address, from the env sender', async () => {
    const { sendFn, sent } = recorder();
    await sendResetPasswordEmail(ENV, { to: 'b@example.com', url: URL_WITH_QUERY }, sendFn);

    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('Reset your password');
    expect(sent[0].to).toBe('b@example.com');
    expect(sent[0].from).toBe(ENV.RESEND_FROM_EMAIL);
    expect(sent[0].replyTo).toBe(ENV.RESEND_REPLY_TO_EMAIL);
    expect(sent[0].html).toContain(URL_WITH_QUERY);
    expect(sent[0].text).toContain(URL_WITH_QUERY);
  });

  it('rejects with the provider message when Resend reports an error', async () => {
    const { sendFn } = recorder({ error: { message: 'rate_limit_exceeded' } });
    await expect(
      sendResetPasswordEmail(ENV, { to: 'b@example.com', url: URL_WITH_QUERY }, sendFn),
    ).rejects.toThrow(/rate_limit_exceeded/);
  });
});

describe('the transactional/bulk boundary', () => {
  it('🟡 neither email carries a List-Unsubscribe header of any kind', async () => {
    // These are transactional: a user cannot meaningfully "unsubscribe" from the
    // verification or password-reset mail they just asked for, and offering it would
    // break account recovery for whoever clicks. apps/server's *scheduled* mail is
    // the opposite — it must carry all three RFC 8058 headers. Until now that
    // distinction lived only in a code comment.
    const { sendFn, sent } = recorder();
    await sendVerificationEmail(ENV, { to: 'a@example.com', url: URL_WITH_QUERY }, sendFn);
    await sendResetPasswordEmail(ENV, { to: 'a@example.com', url: URL_WITH_QUERY }, sendFn);

    expect(sent).toHaveLength(2);
    for (const msg of sent) {
      // No custom headers at all — not merely no List-Unsubscribe value.
      expect(Object.keys(msg)).not.toContain('headers');
      expect(JSON.stringify(msg)).not.toMatch(/List-Unsubscribe/i);
      expect(JSON.stringify(msg)).not.toMatch(/List-Id/i);
      // ...and no unsubscribe link smuggled into the body either.
      expect(msg.html).not.toMatch(/unsubscribe/i);
      expect(msg.text).not.toMatch(/unsubscribe/i);
    }
  });

  it('does not construct a Resend client when a transport is injected', async () => {
    // The seam has to be a real seam: if `send()` still built `new Resend(...)`
    // eagerly it would throw here (no RESEND_API_KEY on this fake env).
    const { sendFn } = recorder();
    const spy = vi.fn(sendFn);
    await expect(
      sendVerificationEmail({} as Env, { to: 'a@example.com', url: 'https://x' }, spy),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledOnce();
  });
});
