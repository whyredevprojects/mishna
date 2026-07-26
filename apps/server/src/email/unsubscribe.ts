/**
 * RFC 8058 one-click unsubscribe — the signed token, the URL, and the
 * self-contained landing page.
 *
 * The token is a stateless, HMAC-signed claim about *who* is unsubscribing (and
 * from what), so the endpoint needs no session: mail clients POST it from a
 * datacenter with no cookies. It rides in the `List-Unsubscribe` header of every
 * scheduled email (see `sender.ts`) **and** in the visible footer link (Gmail wants
 * both).
 *
 * Format:
 *
 *   payload = "v1.<userId>.<scope>"
 *   token   = base64url(payload) "." base64url(HMAC-SHA256(secret, payload))
 *
 * Notes on the deliberate choices here:
 *
 * - **No timestamp, and therefore no expiry.** A year-old email is still a legitimate
 *   place to unsubscribe from; an expired link there earns a spam report, which is
 *   the exact outcome this feature exists to prevent. Since nothing is ever enforced
 *   against it, minting one would only cost determinism — and that cost is real: the
 *   token rides in the `List-Unsubscribe` header *and* the HTML footer, so a clock in
 *   the payload makes the rendered email differ on every render, while `sender.ts`'s
 *   Resend `Idempotency-Key` is derived from the job (user/kind/week). Resend answers
 *   `409 invalid_idempotent_request` when a key comes back with a different body, so a
 *   retried batch would fail the whole workflow instead of collapsing. The token is a
 *   pure function of (secret, userId, scope) on purpose.
 * - **`scope` is carried but currently always `all`.** The product decision is that
 *   unsubscribing turns off *both* scheduled emails. Keeping the field means granular
 *   links can ship later without a token-format change (old links keep verifying).
 * - **Secret rotation.** `UNSUBSCRIBE_SECRET` is a comma-separated list: new tokens are
 *   signed with the first, verification accepts any of them. Rotate by prepending the
 *   new secret, then dropping the old one once the mail carrying it has aged out.
 * - Verification uses `crypto.subtle.verify` (constant-time inside the runtime), never
 *   a string comparison of hex digests.
 * - Every parse failure (missing dot, bad base64, wrong version, unknown scope) is a
 *   `null` return, never a throw — a malformed link must render a friendly page, not a
 *   500.
 */

export type UnsubscribeScope = 'all' | 'weekly' | 'reminder';

export interface UnsubscribeClaims {
  userId: string;
  scope: UnsubscribeScope;
}

// The payload's version tag: the lever for changing the format later (verify can then
// accept both while old mail ages out). It stays `v1` here because the four-field
// `v1.<userId>.<scope>.<issuedAt>` shape it briefly had never shipped — no token of
// that form exists outside an unpushed branch, so there is nothing to stay
// compatible with.
const VERSION = 'v1';
const SCOPES: readonly string[] = ['all', 'weekly', 'reminder'];

// -- base64url --------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Decode base64url, or `null` for anything that isn't valid base64url. */
function fromBase64Url(text: string): Uint8Array | null {
  if (text === '' || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const padded =
    text.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (text.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

// -- signing ----------------------------------------------------------------

/** The configured secrets, newest first. Empty when unconfigured. */
function signingSecrets(secret: string | undefined): string[] {
  return (secret ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Mint a token for a user. Signed with the **first** configured secret, and
 * **deterministic** — the same (secret, userId, scope) always yields the same token,
 * which is what keeps a re-rendered email byte-identical (see the header note).
 * Throws only when `UNSUBSCRIBE_SECRET` is missing entirely — a misconfiguration
 * the send path should fail loudly on rather than mail unusable links.
 */
export async function mintUnsubscribeToken(
  secret: string | undefined,
  userId: string,
  scope: UnsubscribeScope = 'all',
): Promise<string> {
  const secrets = signingSecrets(secret);
  if (secrets.length === 0) {
    throw new Error(
      'UNSUBSCRIBE_SECRET is not set — cannot sign unsubscribe links (wrangler secret put UNSUBSCRIBE_SECRET)',
    );
  }
  const payload = `${VERSION}.${userId}.${scope}`;
  const bytes = new TextEncoder().encode(payload);
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', await importKey(secrets[0]), bytes),
  );
  return `${toBase64Url(bytes)}.${toBase64Url(signature)}`;
}

/**
 * The claims a payload encodes, or `null` if it isn't one of ours. Parsed from the
 * ends inward so a userId containing a `.` can't shift the fields.
 */
function parseClaims(payload: string): UnsubscribeClaims | null {
  const parts = payload.split('.');
  if (parts.length < 3 || parts[0] !== VERSION) return null;
  const scope = parts[parts.length - 1];
  const userId = parts.slice(1, -1).join('.');
  if (!SCOPES.includes(scope)) return null;
  if (userId === '') return null;
  return { userId, scope: scope as UnsubscribeScope };
}

/**
 * Verify a token against every configured secret and return its claims, or `null`
 * if it's malformed, truncated, or not signed by us. Never throws.
 */
export async function verifyUnsubscribeToken(
  secret: string | undefined,
  token: string | undefined | null,
): Promise<UnsubscribeClaims | null> {
  const secrets = signingSecrets(secret);
  if (secrets.length === 0 || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const payloadBytes = fromBase64Url(parts[0]);
  const signature = fromBase64Url(parts[1]);
  if (!payloadBytes || !signature) return null;

  let valid = false;
  for (const s of secrets) {
    if (
      await crypto.subtle.verify(
        'HMAC',
        await importKey(s),
        signature,
        payloadBytes,
      )
    ) {
      valid = true;
      break;
    }
  }
  if (!valid) return null;
  return parseClaims(new TextDecoder().decode(payloadBytes));
}

/** The link that goes in the mail: header + visible footer. */
export function unsubscribeUrl(
  appOrigin: string,
  token: string,
  lang?: UnsubscribeLang,
): string {
  const base = `${appOrigin.replace(/\/+$/, '')}/api/unsubscribe?t=${encodeURIComponent(token)}`;
  return lang ? `${base}&lang=${lang}` : base;
}

// -- the landing page -------------------------------------------------------
// Rendered by this worker as self-contained HTML rather than as an Angular route:
// the page must work for a mail client hitting the API host directly (no CORS, no
// session, no SPA bundle), and it keeps the /he/ i18n catalogs out of the loop.

export type UnsubscribeLang = 'en' | 'he';

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
const COPY = {
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `/settings` in the right locale build (the Hebrew client is served under /he/). */
function settingsUrl(appOrigin: string, lang: UnsubscribeLang): string {
  return `${appOrigin.replace(/\/+$/, '')}${lang === 'he' ? '/he' : ''}/settings`;
}

function page(
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
