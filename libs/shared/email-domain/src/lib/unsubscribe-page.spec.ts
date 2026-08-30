import {
  confirmPageHtml,
  donePageHtml,
  errorPageHtml,
  escapeHtml,
  pickLang,
  plainDone,
  plainError,
  settingsUrl,
} from './unsubscribe-page';

// The unsubscribe landing page: language negotiation + the HTML it builds. Pure
// string work, so it runs in plain node. The route-level behavior (status codes, the
// no-store/no-referrer headers, that the rendered form really unsubscribes when
// posted) stays in apps/server's integration test.

describe('pickLang', () => {
  it('honors ?lang over anything the browser asks for', () => {
    expect(pickLang('he', 'en-US,en;q=0.9')).toBe('he');
    expect(pickLang('en', 'he-IL')).toBe('en');
    expect(pickLang('fr', 'he-IL')).toBe('he'); // unknown ?lang falls through
  });

  it('ranks Accept-Language by q rather than scanning for "he"', () => {
    // The whole point: `he` appears, but ranked *below* English.
    expect(pickLang(undefined, 'en-US,en;q=0.9,he;q=0.5')).toBe('en');
    expect(pickLang(undefined, 'he-IL,he;q=0.9')).toBe('he');
    expect(pickLang(undefined, 'en;q=0.5,he;q=0.8')).toBe('he');
    // q=0 means "not acceptable", so the next tag wins.
    expect(pickLang(undefined, 'he;q=0,en')).toBe('en');
  });

  it('treats the legacy `iw` tag as Hebrew', () => {
    expect(pickLang(undefined, 'iw-IL')).toBe('he');
    expect(pickLang(undefined, 'iw')).toBe('he');
  });

  it('falls back to English with no (or a useless) header', () => {
    expect(pickLang(undefined, undefined)).toBe('en');
    expect(pickLang(undefined, '')).toBe('en');
    expect(pickLang(undefined, '*')).toBe('en');
    // "hebrew-ish" prefixes must not count.
    expect(pickLang(undefined, 'hen,heb')).toBe('en');
  });

  it('keeps header order on a q tie (Array#sort is stable)', () => {
    expect(pickLang(undefined, 'he,en')).toBe('he');
    expect(pickLang(undefined, 'en,he')).toBe('en');
  });
});

describe('settingsUrl', () => {
  it('points at the locale build the page is rendered in', () => {
    expect(settingsUrl('https://app.test', 'en')).toBe(
      'https://app.test/settings',
    );
    // The Hebrew client is a separate build served under /he/.
    expect(settingsUrl('https://app.test', 'he')).toBe(
      'https://app.test/he/settings',
    );
  });

  it('does not double the slash on a trailing-slash origin', () => {
    // APP_ORIGIN is generated, but a hand-edited .dev.vars easily grows a slash.
    expect(settingsUrl('https://app.test/', 'en')).toBe(
      'https://app.test/settings',
    );
    expect(settingsUrl('https://app.test///', 'he')).toBe(
      'https://app.test/he/settings',
    );
  });
});

describe('escapeHtml', () => {
  it('neutralizes the four characters that can break out of markup', () => {
    expect(escapeHtml('<script>&"')).toBe('&lt;script&gt;&amp;&quot;');
  });
});

describe('the rendered pages', () => {
  const TOKEN = 'v1payload.v1sig';

  it('sets lang/dir per language', () => {
    expect(confirmPageHtml('en', TOKEN, 'https://app.test')).toContain(
      '<html lang="en" dir="ltr">',
    );
    expect(confirmPageHtml('he', TOKEN, 'https://app.test')).toContain(
      '<html lang="he" dir="rtl">',
    );
  });

  it("the confirm form's action carries the encoded token and the language", () => {
    const html = confirmPageHtml('he', TOKEN, 'https://app.test');
    const action = /<form method="post" action="([^"]+)"/.exec(html)?.[1];
    expect(action).toBe(
      `/api/unsubscribe?t=${encodeURIComponent(TOKEN)}&amp;lang=he`,
    );
    // The RFC 8058 body a one-click client would post, so the form and the machine
    // path hit the endpoint identically.
    expect(html).toContain(
      '<input type="hidden" name="List-Unsubscribe" value="One-Click" />',
    );
  });

  it('escapes a hostile token instead of reflecting it into the page', () => {
    // ?t= is attacker-controlled and lands in an attribute. It must survive
    // encodeURIComponent + escapeHtml with no raw `<`, `>` or `"` anywhere.
    const hostile = '"><script>alert(1)</script>';
    const html = confirmPageHtml('en', hostile, 'https://app.test');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('"><script>');
    const action = /<form method="post" action="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(action).toContain(encodeURIComponent(hostile));
  });

  it('never renders a token on the done/error pages at all', () => {
    // Neither page takes one — the URL is a live bearer credential and has no
    // business being echoed back after the mutation.
    for (const html of [
      donePageHtml('en', 'https://app.test'),
      errorPageHtml('en', 'https://app.test'),
    ]) {
      // (the `?t=` in the page's own HTML comment doesn't count — no *link* carries it)
      expect(html).not.toMatch(/(href|action)="[^"]*\?t=/);
      expect(html).not.toContain('<form');
      expect(html).toContain('https://app.test/settings');
      // Belt to the Referrer-Policy header the routes set: the link is same-origin.
      expect(html).toContain('<meta name="referrer" content="no-referrer" />');
      expect(html).toContain('<meta name="robots" content="noindex" />');
    }
  });

  it('says the right thing on each page, in each language', () => {
    expect(donePageHtml('en', 'https://app.test')).toContain(
      "You've been unsubscribed",
    );
    expect(errorPageHtml('en', 'https://app.test')).toContain(
      "This unsubscribe link isn't valid",
    );
    // The error page must not read like a success — a human who clicked a mangled
    // link has to know it didn't work, or they report spam instead.
    expect(errorPageHtml('en', 'https://app.test')).not.toContain(
      'been unsubscribed',
    );
    expect(donePageHtml('he', 'https://app.test')).toContain('ההרשמה בוטלה');
  });

  it('brands every page with the product name, not the domain', () => {
    // It must match the From: display name the recipient just saw, or the page is
    // the "I don't recognize this" moment this whole feature exists to avoid.
    for (const html of [
      confirmPageHtml('en', TOKEN, 'https://app.test'),
      donePageHtml('en', 'https://app.test'),
      errorPageHtml('en', 'https://app.test'),
    ]) {
      expect(html).toContain('Chevras Mishnayos Baal Peh');
      expect(html).not.toContain('mishna2go');
    }
    expect(donePageHtml('he', 'https://app.test')).toContain('חברת משניות בעל פה');
  });

  it('has a plain-text body for the machine POST in both languages', () => {
    expect(plainDone('en')).toMatch(/unsubscribed/i);
    expect(plainError('en')).toMatch(/Invalid or malformed/i);
    expect(plainDone('he')).not.toBe(plainDone('en'));
    for (const s of [plainDone('en'), plainError('en'), plainDone('he')]) {
      expect(s).not.toContain('<');
    }
  });
});
