// Static-assets Worker for the marketing site.
//
// Cloudflare serves the Eleventy build (`_site`, bound as ASSETS) directly for every
// real file, so this handler only runs for requests that don't map to a static asset.
// Its one job is the apex root `/`, which is not an Eleventy page: negotiate the
// visitor's language (an explicit `lang` cookie first, else the Accept-Language header)
// and 302 them to `/en/` or `/he/`. Anything else that reaches here is delegated back
// to the static assets (which yields their normal 404 handling for unknown paths).
//
// This replaces the earlier Cloudflare Pages Function — www now deploys as a
// static-assets Worker (see wrangler.toml), where request logic lives in `main`.

const SUPPORTED = ['en', 'he'];
const DEFAULT_LANG = 'en';
const COOKIE_NAME = 'lang';

function parseAcceptLanguage(header) {
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

function pickLanguage(request) {
  const cookie = request.headers.get('Cookie') ?? '';
  const chosen = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (chosen && SUPPORTED.includes(chosen[1])) return chosen[1];
  for (const tag of parseAcceptLanguage(request.headers.get('Accept-Language'))) {
    if (SUPPORTED.includes(tag)) return tag;
  }
  return DEFAULT_LANG;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      const lang = pickLanguage(request);
      return new Response(null, {
        status: 302,
        headers: {
          Location: `/${lang}/`,
          'Set-Cookie': `${COOKIE_NAME}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`,
          'Cache-Control': 'no-store',
          Vary: 'Accept-Language',
        },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
