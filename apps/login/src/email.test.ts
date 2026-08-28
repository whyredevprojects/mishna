import { describe, expect, it } from 'vitest';
import { shell } from './email';

// The body builder only — `send()` is what constructs `Resend`, so importing this
// module is side-effect-free and no binding/stub is needed.

const URL_WITH_QUERY =
  'https://app.mishna2go.com/api/auth/verify-email?token=abc.def&callbackURL=%2Fdashboard';

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
