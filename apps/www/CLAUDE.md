# apps/www

Public marketing site for Chevras Mishnayos Baal Peh — an [Eleventy (11ty)](https://www.11ty.dev)
static site deployed to Cloudflare Pages. This is the **apex** front door
(`getchevrasmishnayos.com`); the Angular app lives at `app.getchevrasmishnayos.com`,
which this site links to for **Log in** / **Sign up**.

## Internationalization (/en, /he)

The site is served in two locales via the bundled **EleventyI18nPlugin**
(`defaultLanguage: 'en'`, `errorMode: 'allow-fallback'`). Content lives in per-locale
directories, `src/en/` and `src/he/`, each carrying a directory data file
(`en.json` / `he.json`) that sets `lang` + `dir`. Default 11ty permalinks then give
`/en/…` and `/he/…` for free. UI strings are centralized in **`src/_data/strings.json`**
(`{ en: {…}, he: {…} }`), referenced in templates as `strings[lang]`.

- `src/en/index.njk` / `src/he/index.njk` → the `/en/` and `/he/` landing pages
  (`landing.njk`).
- `src/en/about.md` → `/en/about/` (the admin-editable English About; see below).
- `src/he/about.njk` → `/he/about/` (a Hebrew About placeholder).

The **root `/`** is not an Eleventy page. `functions/index.ts` is a Cloudflare Pages
Function that negotiates `Accept-Language` (and a `lang` cookie) and 302-redirects to
`/en/` or `/he/`. Because Wrangler discovers Pages Functions at `process.cwd()/functions`
with no override flag, the `deploy` target runs with **`cwd: apps/www`** (see
`project.json`).

## The admin-editable region

The English About copy ("general info about the program") is **`src/en/about.md`** —
**pure Markdown, no front matter**. It is edited from inside the app at `/admin/about`
(Toast UI editor), which commits the raw Markdown to this file via the GitHub Contents API
(`apps/server` `POST /api/admin/about`, path from its `ABOUT_MD_PATH` var). A commit to
`main` triggers CI, which rebuilds and redeploys this site. **Do not add front matter to
`about.md`** — the editor would overwrite it and the admin could break the page.

A template data file (`src/en/about.11tydata.json`) gives `about.md` the `about.njk`
layout, so it renders at `/en/about/`. The page chrome — the header (Log in / Sign up +
language switcher) and the join CTA — is fixed in `_includes/base.njk`. Markdown template
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
| `project.json` | Nx targets: `build` (cached, `outputs: _site`), `serve`, `deploy` (Pages; runs with `cwd: apps/www` so Wrangler finds `functions/`). |
| `functions/index.ts` | Cloudflare Pages Function owning `/` — Accept-Language/cookie negotiation → 302 to `/en/` or `/he/`. |
| `src/en/about.md` | The admin-editable English About copy (pure Markdown). |
| `src/en/about.11tydata.json` | Applies the `about.njk` layout to `about.md`. |
| `src/en/en.json`, `src/he/he.json` | Directory data files: `lang` + `dir` per locale. |
| `src/en/index.njk`, `src/he/index.njk` | The `/en/` and `/he/` landing pages. |
| `src/he/about.njk` | Hebrew About placeholder → `/he/about/`. |
| `src/_includes/base.njk` | Shared shell: `<html lang dir>`, head + hreflang/canonical, header w/ language switcher, footer, scripts. Loads PhotoSwipe CSS + `src/js/lightbox.js`. |
| `src/_includes/landing.njk` | Landing body (hero + how-it-works), over `base.njk`. |
| `src/_includes/about.njk` | About body (renders the `.about` content), over `base.njk`. |
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

## Deploy (TODO to wire fully)

`nx build www` runs in CI on push to main; `nx affected -t deploy` deploys `_site` to a
Cloudflare Pages project (`deploy` target uses `--project-name=chevramishnayos-www`).
**TODO at deploy time:** create that Pages project, point apex
`getchevrasmishnayos.com` at it, and move the Angular app to
`app.getchevrasmishnayos.com` (client Pages custom domain + the server/login Worker
`routes` + `BETTER_AUTH_URL`/`APP_ORIGIN`/trusted origins). The Angular client is
host-agnostic (relative `/api/*`).
