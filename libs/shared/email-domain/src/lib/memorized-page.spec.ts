import { COPY } from './unsubscribe-page';
import {
  MEMORIZED_COPY,
  dashboardUrl,
  memorizedConfirmPageHtml,
  memorizedDonePageHtml,
  memorizedErrorPageHtml,
  plainMemorizedDone,
  plainMemorizedError,
} from './memorized-page';

// The "I've memorized this" landing page. Pure string building, so plain node. The
// HTTP behavior it backs (read-only GET, the always-200 responses, the session
// handshake) lives in apps/server's `memorized.integration.test.ts`.

const ORIGIN = 'https://app.example.com';

describe('memorized landing page', () => {
  describe('dashboardUrl', () => {
    it('sends Hebrew readers to the /he/ build', () => {
      expect(dashboardUrl(ORIGIN, 'en')).toBe(`${ORIGIN}/dashboard`);
      expect(dashboardUrl(ORIGIN, 'he')).toBe(`${ORIGIN}/he/dashboard`);
    });

    it('trims trailing slashes off the origin', () => {
      expect(dashboardUrl('https://app.example.com///', 'he')).toBe(
        `${ORIGIN}/he/dashboard`,
      );
    });
  });

  describe('the confirm page (GET)', () => {
    const html = memorizedConfirmPageHtml('en', 'tok-123', ORIGIN);

    it('POSTs — a GET must never mutate, because mail scanners follow every link', () => {
      expect(html).toContain('method="post"');
      expect(html).toContain('action="/api/memorized?lang=en"');
    });

    it('carries the token in a hidden field, not in the form action', () => {
      // The token is a live login capability for its first week. Keeping it out of the
      // POST URL keeps it out of request logs and browser history.
      expect(html).toContain(
        '<input type="hidden" name="t" value="tok-123" />',
      );
      expect(html).not.toContain('action="/api/memorized?lang=en&t=');
      expect(html).not.toMatch(/action="[^"]*tok-123/);
    });

    it('keeps an explicit ?lang choice across the POST', () => {
      expect(memorizedConfirmPageHtml('he', 'tok', ORIGIN)).toContain(
        'action="/api/memorized?lang=he"',
      );
    });

    it('escapes a hostile token in the hidden input', () => {
      const hostile = '"><script>alert(1)</script>';
      const out = memorizedConfirmPageHtml('en', hostile, ORIGIN);
      expect(out).not.toContain('<script>');
      expect(out).toContain('&quot;&gt;&lt;script&gt;');
    });

    it('renders the confirm copy and a way back to the app', () => {
      expect(html).toContain(MEMORIZED_COPY.en.confirmButton);
      expect(html).toContain(`href="${ORIGIN}/dashboard"`);
    });
  });

  describe('the done and error pages (POST)', () => {
    it('tells the reader the marking happened and points at the app', () => {
      const html = memorizedDonePageHtml('en', ORIGIN);
      expect(html).toContain(MEMORIZED_COPY.en.doneBody);
      expect(html).toContain(`href="${ORIGIN}/dashboard"`);
    });

    it('does not distinguish an invalid token from an expired one', () => {
      // One page for both: nothing tells them apart for the reader, and merging them
      // avoids telling a probe whether a token was ever real.
      expect(memorizedErrorPageHtml('en', ORIGIN)).toContain(
        MEMORIZED_COPY.en.errorTitle,
      );
      expect(MEMORIZED_COPY.en.errorBody).toMatch(/expired/);
    });

    it('renders the Hebrew build right-to-left', () => {
      const html = memorizedDonePageHtml('he', ORIGIN);
      expect(html).toContain('dir="rtl"');
      expect(html).toContain('lang="he"');
      expect(html).toContain(`href="${ORIGIN}/he/dashboard"`);
    });

    it('has plain-text bodies for a client that did not ask for HTML', () => {
      expect(plainMemorizedDone('en')).toBe(MEMORIZED_COPY.en.plainDone);
      expect(plainMemorizedError('he')).toBe(MEMORIZED_COPY.he.plainError);
    });
  });

  it('is branded exactly like the unsubscribe page', () => {
    // Both pages have to match the From: line the reader just saw. A page branded
    // anything else is the "I do not recognize this" moment that earns a spam report.
    expect(MEMORIZED_COPY.en.brand).toBe(COPY.en.brand);
    expect(MEMORIZED_COPY.he.brand).toBe(COPY.he.brand);
    expect(memorizedDonePageHtml('he', ORIGIN)).toContain(COPY.he.brand);
  });

  it('keeps every page out of search indexes and Referer headers', () => {
    for (const html of [
      memorizedConfirmPageHtml('en', 't', ORIGIN),
      memorizedDonePageHtml('en', ORIGIN),
      memorizedErrorPageHtml('en', ORIGIN),
    ]) {
      expect(html).toContain('name="robots" content="noindex"');
      expect(html).toContain('name="referrer" content="no-referrer"');
    }
  });
});
