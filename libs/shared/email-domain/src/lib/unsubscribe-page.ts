// ---------------------------------------------------------------------------
// The unsubscribe landing page — self-contained bilingual HTML, plus the
// `Accept-Language` negotiation that picks its language.
//
// Rendered by the server worker as plain HTML rather than as an Angular route: the
// page must work for a mail client hitting the API host directly (no CORS, no
// session, no SPA bundle), and it keeps the /he/ i18n catalogs out of the loop.
//
// Pure string building — no clock, no storage, no runtime globals — so it is
// unit-testable in plain node even though it only ever runs inside a Worker.
// ---------------------------------------------------------------------------

import { UnsubscribeLang } from './unsubscribe-token';

export type { UnsubscribeLang } from './unsubscribe-token';

/**
 * `?lang`, else the best-ranked `Accept-Language` tag, else English.
 *
 * The header is a *ranked* list, not a set: `en-US,en;q=0.9,he;q=0.5` means "English,
 * or Hebrew if you must" — testing whether `he` appears anywhere would serve that user
 * Hebrew. So rank by q (defaulting to 1, dropping `q=0` = explicitly unacceptable) and
 * look only at the winner. Ties keep header order, since `Array#sort` is stable.
 * `iw` is the legacy ISO code for Hebrew and some clients still send it.
 */
export function pickLang(
  queryLang: string | undefined,
  acceptLanguage: string | undefined,
): UnsubscribeLang {
  if (queryLang === 'he' || queryLang === 'en') return queryLang;
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((entry) => {
      const [tag, ...params] = entry.trim().split(';');
      const q = params
        .map((p) => /^q=([\d.]+)$/i.exec(p.trim())?.[1])
        .find((v) => v !== undefined);
      const quality = q === undefined ? 1 : Number(q);
      return {
        primary: tag.trim().toLowerCase().split('-')[0],
        q: Number.isFinite(quality) ? quality : 0,
      };
    })
    .filter((t) => t.primary !== '' && t.q > 0)
    .sort((a, b) => b.q - a.q);
  const best = ranked[0]?.primary;
  return best === 'he' || best === 'iw' ? 'he' : 'en';
}

// The product's name, in both languages — *not* the domain (mishna2go.com). This is
// the name on the `From:` line the recipient just saw (config/domains.json's email
// display name, the www site's site.json, the app shell's title), and a page branded
// anything else is the "I don't recognize this — mark as spam" moment this whole
// feature exists to avoid.
export const COPY = {
  en: {
    dir: 'ltr',
    brand: 'Chevras Mishnayos Baal Peh',
    confirmTitle: 'Unsubscribe from Chevras Mishnayos Baal Peh emails',
    confirmBody:
      'Confirm below to stop receiving the weekly mishnayos email and the weekly reminder.',
    confirmButton: 'Unsubscribe',
    doneTitle: "You've been unsubscribed",
    doneBody:
      "You won't get the weekly mishnayos email or the reminder any more. Changed your mind? You can turn them back on any time in Settings.",
    settingsLink: 'Open settings',
    errorTitle: "This unsubscribe link isn't valid",
    errorBody:
      'It may have been shortened or truncated by your email app. You can turn these emails off any time in Settings.',
    plainDone:
      'You have been unsubscribed from Chevras Mishnayos Baal Peh emails.',
    plainError: 'Invalid or malformed unsubscribe token.',
  },
  he: {
    dir: 'rtl',
    brand: 'חברת משניות בעל פה',
    confirmTitle: 'ביטול הרשמה למיילים של חברת משניות בעל פה',
    confirmBody:
      'אשרו כאן כדי להפסיק לקבל את המייל השבועי עם המשניות ואת מייל התזכורת.',
    confirmButton: 'בטלו את ההרשמה',
    doneTitle: 'ההרשמה בוטלה',
    doneBody:
      'לא תקבלו יותר את המייל השבועי עם המשניות או את התזכורת. שיניתם את דעתכם? אפשר להפעיל אותם מחדש בכל עת בהגדרות.',
    settingsLink: 'פתחו את ההגדרות',
    errorTitle: 'קישור ביטול ההרשמה אינו תקין',
    errorBody:
      'ייתכן שהקישור נקטע על ידי תוכנת הדואר. תמיד אפשר לכבות את המיילים האלה בהגדרות.',
    plainDone: 'ההרשמה למיילים של חברת משניות בעל פה בוטלה.',
    plainError: 'אסימון ביטול הרשמה שגוי או פגום.',
  },
} as const;

/**
 * The four characters that can break out of text content or an attribute value.
 * Exported because every interpolation on this page — including the attacker-supplied
 * `?t=` token, which lands in the form's `action` — goes through it.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `/settings` in the right locale build (the Hebrew client is served under /he/). */
export function settingsUrl(appOrigin: string, lang: UnsubscribeLang): string {
  return `${appOrigin.replace(/\/+$/, '')}${lang === 'he' ? '/he' : ''}/settings`;
}

export function page(
  lang: UnsubscribeLang,
  title: string,
  bodyHtml: string,
  brand: string,
): string {
  const dir = COPY[lang].dir;
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="robots" content="noindex" />
    <!--
      The URL carries the (never-expiring) unsubscribe token in ?t=, and this page
      links to the app's own /settings — same-origin, so the default
      strict-origin-when-cross-origin policy would send the *full* URL as Referer.
      Belt to the Referrer-Policy header the routes set.
    -->
    <meta name="referrer" content="no-referrer" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:#f5f3ee;font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;">
    <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
      <h1 style="font-size:22px;margin:0 0 16px;">${escapeHtml(title)}</h1>
      ${bodyHtml}
      <hr style="border:none;border-top:1px solid #ddd;margin:28px 0 16px;" />
      <p style="color:#888;font-size:13px;margin:0;">${escapeHtml(brand)}</p>
    </div>
  </body>
</html>`;
}

/**
 * The GET page: a confirmation **form**, nothing else. GET is strictly read-only —
 * mail scanners and link-preview bots fetch every URL in a message, so a mutating GET
 * would silently unsubscribe people who never clicked. The form POSTs the same
 * `List-Unsubscribe=One-Click` body RFC 8058 clients send.
 */
export function confirmPageHtml(
  lang: UnsubscribeLang,
  token: string,
  appOrigin: string,
): string {
  const t = COPY[lang];
  const action = `/api/unsubscribe?t=${encodeURIComponent(token)}&lang=${lang}`;
  return page(
    lang,
    t.confirmTitle,
    `<p style="color:#444;line-height:1.6;margin:0 0 20px;">${escapeHtml(t.confirmBody)}</p>
      <form method="post" action="${escapeHtml(action)}">
        <input type="hidden" name="List-Unsubscribe" value="One-Click" />
        <button type="submit" style="display:inline-block;background:#7a5c00;color:#fff;border:none;font:inherit;cursor:pointer;padding:10px 20px;border-radius:6px;">${escapeHtml(t.confirmButton)}</button>
      </form>
      <p style="margin:20px 0 0;"><a href="${escapeHtml(settingsUrl(appOrigin, lang))}" style="color:#7a5c00;">${escapeHtml(t.settingsLink)}</a></p>`,
    t.brand,
  );
}

/** The POST success page (for a human who came from the form). */
export function donePageHtml(lang: UnsubscribeLang, appOrigin: string): string {
  const t = COPY[lang];
  return page(
    lang,
    t.doneTitle,
    `<p style="color:#444;line-height:1.6;margin:0 0 20px;">${escapeHtml(t.doneBody)}</p>
      <p style="margin:0;"><a href="${escapeHtml(settingsUrl(appOrigin, lang))}" style="color:#7a5c00;">${escapeHtml(t.settingsLink)}</a></p>`,
    t.brand,
  );
}

/** The POST failure page: a bad/garbled token. */
export function errorPageHtml(
  lang: UnsubscribeLang,
  appOrigin: string,
): string {
  const t = COPY[lang];
  return page(
    lang,
    t.errorTitle,
    `<p style="color:#444;line-height:1.6;margin:0 0 20px;">${escapeHtml(t.errorBody)}</p>
      <p style="margin:0;"><a href="${escapeHtml(settingsUrl(appOrigin, lang))}" style="color:#7a5c00;">${escapeHtml(t.settingsLink)}</a></p>`,
    t.brand,
  );
}

/** Plain-text bodies, for the machine (one-click) POST. */
export function plainDone(lang: UnsubscribeLang): string {
  return COPY[lang].plainDone;
}

export function plainError(lang: UnsubscribeLang): string {
  return COPY[lang].plainError;
}
