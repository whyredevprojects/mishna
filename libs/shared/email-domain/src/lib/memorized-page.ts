// ---------------------------------------------------------------------------
// The "I've memorized this" landing page — self-contained bilingual HTML, sharing
// its shell (`page`, `escapeHtml`, `pickLang`, `appUrl`) with the unsubscribe page.
//
// Same reasoning as that page for being plain HTML rather than an Angular route: it
// has to work for someone arriving straight from a mail client with no session and no
// SPA bundle, and it keeps the /he/ i18n catalogs out of the loop.
//
// **Three states, not five.** "Invalid" and "expired" collapse into one error page —
// nothing distinguishes them for the reader, and merging them avoids telling a probe
// whether a token was ever real. "A different user holds this browser's session" and
// "the 7-day login window has closed" collapse into one done page, because in both
// cases the mishnayot *were* marked and the only honest thing left to say is "open the
// app".
//
// Pure string building — no clock, no storage, no runtime globals.
// ---------------------------------------------------------------------------

import {
  COPY as UNSUB_COPY,
  appUrl,
  escapeHtml,
  page,
} from './unsubscribe-page';
import { UnsubscribeLang } from './unsubscribe-token';

export type { UnsubscribeLang } from './unsubscribe-token';

// The brand strings are taken from the unsubscribe page's COPY rather than retyped:
// they must match the `From:` line the recipient just saw, and two hand-maintained
// copies of a brand name is exactly how they drift.
export const MEMORIZED_COPY = {
  en: {
    brand: UNSUB_COPY.en.brand,
    confirmTitle: 'Mark these mishnayos as memorized',
    confirmBody:
      "Confirm below and we'll mark the mishnayos from your email as learned.",
    confirmButton: "Yes — I've memorized them",
    doneTitle: 'Marked as memorized',
    doneBody:
      "We've marked those mishnayos as learned. Open the app to see your progress.",
    appLink: 'Open the app',
    errorTitle: "This link isn't valid any more",
    errorBody:
      'It may have expired, or been shortened or truncated by your email app. You can mark mishnayos as learned any time in the app.',
    plainDone: 'Those mishnayos have been marked as learned.',
    plainError: 'Invalid or expired link.',
  },
  he: {
    brand: UNSUB_COPY.he.brand,
    confirmTitle: 'סימון המשניות כנלמדו',
    confirmBody: 'אשרו כאן ונסמן את המשניות מהמייל שלכם כנלמדו.',
    confirmButton: 'כן, שיננתי אותן',
    doneTitle: 'סומן כנלמד',
    doneBody:
      'סימנו עבורכם את המשניות האלה כנלמדו. פתחו את האפליקציה כדי לראות את ההתקדמות שלכם.',
    appLink: 'פתחו את האפליקציה',
    errorTitle: 'הקישור אינו תקין יותר',
    errorBody:
      'ייתכן שתוקפו פג, או שהקישור נקטע על ידי תוכנת הדואר. תמיד אפשר לסמן משניות כנלמדו באפליקציה.',
    plainDone: 'המשניות האלה סומנו כנלמדו.',
    plainError: 'קישור שגוי או שתוקפו פג.',
  },
} as const;

/** `/dashboard` in the right locale build — where a signed-in click lands. */
export function dashboardUrl(appOrigin: string, lang: UnsubscribeLang): string {
  return appUrl(appOrigin, lang, '/dashboard');
}

const BUTTON_STYLE =
  'display:inline-block;background:#7a5c00;color:#fff;border:none;font:inherit;cursor:pointer;padding:10px 20px;border-radius:6px;';

function linkParagraph(appOrigin: string, lang: UnsubscribeLang): string {
  const t = MEMORIZED_COPY[lang];
  return `<p style="margin:20px 0 0;"><a href="${escapeHtml(dashboardUrl(appOrigin, lang))}" style="color:#7a5c00;">${escapeHtml(t.appLink)}</a></p>`;
}

/**
 * The GET page: a confirmation **form**, nothing else.
 *
 * GET is strictly read-only, and here that is load-bearing twice over. Mail scanners
 * and link-preview bots fetch every URL in a message, so a mutating GET would silently
 * mark mishnayot learned for people who never clicked — and, unlike a stray
 * unsubscribe, they would get no signal at all while their dashboard *and* the content
 * of their next email both quietly advanced. It would also mint a session on a fetch
 * the reader never made. Scanners do not submit forms.
 *
 * The token rides in a **hidden field**, not in the form's `action`: the emailed GET
 * has to carry it in the query string, but the POST does not, and keeping a live login
 * capability out of that URL keeps it out of request logs and browser history. `lang`
 * stays in the query — it isn't a secret, and it preserves an explicit `?lang=` choice
 * across the POST.
 */
export function memorizedConfirmPageHtml(
  lang: UnsubscribeLang,
  token: string,
  appOrigin: string,
): string {
  const t = MEMORIZED_COPY[lang];
  return page(
    lang,
    t.confirmTitle,
    `<p style="color:#444;line-height:1.6;margin:0 0 20px;">${escapeHtml(t.confirmBody)}</p>
      <form method="post" action="${escapeHtml(`/api/memorized?lang=${lang}`)}">
        <input type="hidden" name="t" value="${escapeHtml(token)}" />
        <button type="submit" style="${BUTTON_STYLE}">${escapeHtml(t.confirmButton)}</button>
      </form>
      ${linkParagraph(appOrigin, lang)}`,
    t.brand,
  );
}

/**
 * The POST success page for a reader we did *not* sign in — either someone else holds
 * this browser's session, or the login window has closed. The marking happened either
 * way; this page says so and points at the app.
 */
export function memorizedDonePageHtml(
  lang: UnsubscribeLang,
  appOrigin: string,
): string {
  const t = MEMORIZED_COPY[lang];
  return page(
    lang,
    t.doneTitle,
    `<p style="color:#444;line-height:1.6;margin:0 0 20px;">${escapeHtml(t.doneBody)}</p>
      ${linkParagraph(appOrigin, lang)}`,
    t.brand,
  );
}

/** The POST failure page: a bad, garbled or expired token. Nothing was written. */
export function memorizedErrorPageHtml(
  lang: UnsubscribeLang,
  appOrigin: string,
): string {
  const t = MEMORIZED_COPY[lang];
  return page(
    lang,
    t.errorTitle,
    `<p style="color:#444;line-height:1.6;margin:0 0 20px;">${escapeHtml(t.errorBody)}</p>
      ${linkParagraph(appOrigin, lang)}`,
    t.brand,
  );
}

/** Plain-text bodies, for a client that asked for something other than HTML. */
export function plainMemorizedDone(lang: UnsubscribeLang): string {
  return MEMORIZED_COPY[lang].plainDone;
}

export function plainMemorizedError(lang: UnsubscribeLang): string {
  return MEMORIZED_COPY[lang].plainError;
}
