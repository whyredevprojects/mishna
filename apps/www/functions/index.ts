// Root Accept-Language negotiation for Cloudflare Pages. Owns only "/".
// Static /en/… and /he/… pages are served directly (this Function does not touch them).
const SUPPORTED = ['en', 'he'] as const;
const DEFAULT_LANG = 'en';
const COOKIE_NAME = 'lang';

function parseAcceptLanguage(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const qp = params.find((p) => p.trim().startsWith('q='));
      const q = qp ? parseFloat(qp.split('=')[1]) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isNaN(q) ? 0 : q };
    })
    .filter((x) => x.tag)
    .sort((a, b) => b.q - a.q)
    .map((x) => x.tag.split('-')[0]);
}

function pickLanguage(request: Request): string {
  const cookie = request.headers.get('Cookie') ?? '';
  const chosen = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (chosen && (SUPPORTED as readonly string[]).includes(chosen[1])) return chosen[1];
  for (const tag of parseAcceptLanguage(request.headers.get('Accept-Language'))) {
    if ((SUPPORTED as readonly string[]).includes(tag)) return tag;
  }
  return DEFAULT_LANG;
}

export const onRequest: PagesFunction = async (context) => {
  const lang = pickLanguage(context.request);
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/${lang}/`,
      'Set-Cookie': `${COOKIE_NAME}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`,
      'Cache-Control': 'no-store',
      Vary: 'Accept-Language',
    },
  });
};
