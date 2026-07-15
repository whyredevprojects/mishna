# apps/www

Public marketing site for Chevras Mishnayos Baal Peh — an [Eleventy (11ty)](https://www.11ty.dev)
static site deployed as a Cloudflare **Worker** (static-assets Worker). This is the **apex**
front door (`getchevrasmishnayos.com`); the Angular app lives at `app.getchevrasmishnayos.com`,
which this site links to for **Log in** / **Sign up**.

## Internationalization (/en, /he)

The site is served in two locales via the bundled **EleventyI18nPlugin**
(`defaultLanguage: 'en'`, `errorMode: 'allow-fallback'`). Content lives in per-locale
directories, `src/en/` and `src/he/`, each carrying a directory data file
(`en.json` / `he.json`) that sets `lang` + `dir`. Default 11ty permalinks then give
`/en/…` and `/he/…` for free. UI strings are centralized in **`src/_data/strings.json`**
(`{ en: {…}, he: {…} }`), referenced in templates as `strings[lang]`.

- `src/en/about.md` → the `/en/` home page (`landing.njk`); the admin-editable English
  About copy, inlined into the landing hero (see below).
- `src/he/about.md` → the `/he/` home page (`landing.njk`); the Hebrew About copy, inlined
  the same way. Not yet wired to the admin editor (English-only for now), but kept as pure
  Markdown so it can be later.

The About copy is the home page — there is no separate `/about/` page. Each `about.md`
renders at its locale's root (`permalink` set in its `about.11tydata.json` sidecar) and is
inlined by `landing.njk` inside the `.about` block, with the eyebrow above and the join CTA
+ "how it works" steps below.

The **root `/`** is not an Eleventy page. `worker.js` — the static-assets Worker's `main`
handler (see `wrangler.toml` / the Deploy section) — negotiates `Accept-Language` (and a
`lang` cookie) and 302-redirects to `/en/` or `/he/`. Every other path maps to a built
static asset, so the Worker only runs for `/`; everything else it delegates to the
`ASSETS` binding.

## The admin-editable region

The English About copy ("general info about the program") is **`src/en/about.md`** —
**pure Markdown, no front matter**. It is edited from inside the app at `/admin/about`
(Toast UI editor), which commits the raw Markdown to this file via the GitHub Contents API
(`apps/server` `POST /api/admin/about`, path from its `ABOUT_MD_PATH` var). A commit to
`main` triggers CI, which rebuilds and redeploys this site. **Do not add front matter to
`about.md`** — the editor would overwrite it and the admin could break the page.

A template data file (`src/en/about.11tydata.json`) gives `about.md` the `landing.njk`
layout and `permalink: /en/`, so it renders as the English home page with the About copy
inlined. The page chrome — the header (Log in / Sign up + language switcher) and the join
CTA — is fixed in `_includes/base.njk` / `_includes/landing.njk`. Markdown template
processing is disabled (`markdownTemplateEngine: false` in `eleventy.config.js`) so stray
`{{ }}`/`{% %}` in admin copy stays literal.

Editor images are uploaded to **Cloudflare R2** (not committed here); `about.md` only ever
references them as absolute `![alt](https://.../about/...)` URLs, so image-only swaps need
no rebuild.

Content images are **click-to-zoom** via [PhotoSwipe](https://photoswipe.com). The author
writes plain `![alt](url)` only — the `<a class="pswp-item">` wrapper is generated at build
by an `amendLibrary('md', …)` image rule in `eleventy.config.js` (extends Eleventy's own
markdown-it instance). PhotoSwipe is self-hosted: its `dist` is passthrough-copied to
`/photoswipe/`, and `src/js/lightbox.js` (a native ESM module) inits it over `.about`.
Dimensions are read at runtime from each image's `naturalWidth`/`naturalHeight` (no
`data-pswp-width/height` in markup) — valid only because the inline `<img>` IS the
full-res original; if inline images ever switch to a resized variant, dimensions must come
from R2 metadata at build instead.

## Layout

| Path | Role |
|------|------|
| `eleventy.config.js` | Dirs (`src` → `_site`), i18n plugin, CSS passthrough, Markdown/HTML engines. |
| `project.json` | Nx targets: `build` (cached, `outputs: _site`), `serve`, `deploy` / `deploy-staging` (Worker). |
| `wrangler.toml` | Static-assets Worker config: `main = ./worker.js`, `[assets] directory = _site` + `binding = ASSETS`, prod name `www-worker`, `[env.staging]` name `staging-www`. |
| `worker.js` | The Worker `main` handler owning `/` — Accept-Language/cookie negotiation → 302 to `/en/` or `/he/`; delegates all other paths to the `ASSETS` binding. |
| `src/en/about.md` | The admin-editable English About copy (pure Markdown); the `/en/` home page. |
| `src/he/about.md` | The Hebrew About copy (pure Markdown); the `/he/` home page. Not yet admin-editable. |
| `src/en/about.11tydata.json`, `src/he/about.11tydata.json` | Apply `landing.njk` + `permalink: /en/` (resp. `/he/`) to each `about.md`. |
| `src/en/en.json`, `src/he/he.json` | Directory data files: `lang` + `dir` per locale. |
| `src/_includes/base.njk` | Shared shell: `<html lang dir>`, head + hreflang/canonical, header w/ language switcher, footer, scripts. Loads PhotoSwipe CSS + `src/js/lightbox.js`. |
| `src/_includes/landing.njk` | Home body (eyebrow + inlined `.about` content + CTA + how-it-works), over `base.njk`. |
| `src/js/lightbox.js` | Initializes PhotoSwipe over the `.about` content images (click-to-zoom). |
| `src/_data/strings.json` | UI strings per locale (`{ en, he }`), referenced as `strings[lang]`. |
| `src/_data/site.json` | Site name/tagline/description + `appUrl` (app host) + `siteUrl` (apex origin, for hreflang/canonical). Both generated from the repo-wide `config/domains.json` (`npm run sync:domains`; see root CLAUDE.md "Changing the domain") — don't hand-edit them. |
| `src/css/styles.css` | Warm, colorful brand styling (brown + gold + teal). |

## Build / serve

- `nx build www` → `apps/www/_site` (cached via Nx Cloud; `outputs` declared so remote
  cache restores instead of rebuilding when inputs are unchanged).
- `nx serve www` → local dev server with live reload.

**Monorepo hoisting**: `@11ty/eleventy` resolves from the *root* `node_modules`, not
`apps/www/node_modules`. The Nx targets call `npx @11ty/eleventy` so the binary resolves
regardless; keep any `addPassthroughCopy`/plugin paths relative to this project root.

## Deploy

Deployed as a **static-assets Cloudflare Worker** via `@naxodev/nx-cloudflare:deploy` (the same
executor as `apps/server` / `apps/login`), which runs `wrangler deploy` from this project root
and auto-discovers `wrangler.toml` here. wrangler serves the built `_site` directly from the
`[assets]` block; the tiny `main = ./worker.js` handler runs only for `/` (root language
negotiation) and serves everything else through the `ASSETS` binding. Both deploy targets
`dependsOn: ["build"]`.

- **Production** — `nx run www:deploy` → `wrangler deploy` → the `www-worker` Worker. CI runs it
  via `nx affected -t deploy` on push to `main`.
- **Staging** — `nx run www:deploy-staging` → `wrangler deploy --env staging` → the `staging-www`
  Worker (`[env.staging]` name override; `[assets]` is inherited). CI runs it on push to the
  `staging` branch.

**Follow-ups (Cloudflare-dashboard, not in repo):** attach the apex `getchevrasmishnayos.com`
custom domain to `www-worker` (both Workers serve at `workers.dev` until then), decommission the
old `chevramishnayos-www` Pages project, and move the Angular app to `app.getchevrasmishnayos.com`
(client custom domain + the server/login Worker `routes` + `BETTER_AUTH_URL`/`APP_ORIGIN`/trusted
origins). The Angular client is host-agnostic (relative `/api/*`).
