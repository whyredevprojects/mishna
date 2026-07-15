# apps/www

Public marketing site for Chevras Mishnayos Baal Peh — an [Eleventy (11ty)](https://www.11ty.dev)
static site deployed as a Cloudflare **Worker** (static-assets Worker). This is the **apex**
front door (`getchevrasmishnayos.com`); the Angular app lives at `app.getchevrasmishnayos.com`,
which this site links to for **Log in** / **Sign up**.

## The admin-editable region

The hero copy ("general info about the program") is **`src/content/about.md`** — **pure
Markdown, no front matter**. It is edited from inside the app at `/admin/about` (Toast UI
editor), which commits the raw Markdown to this file via the GitHub Contents API
(`apps/server` `POST /api/admin/about`). A commit to `main` triggers CI, which rebuilds
and redeploys this site. **Do not add front matter to `about.md`** — the editor would
overwrite it and the admin could break the page.

A directory data file (`src/content/content.11tydata.json`) gives `about.md` the site
layout and the `/` permalink, so `about.md` *is* the homepage body. The page chrome — the
header (Log in / Sign up) and the join CTA — is fixed in `_includes/layout.njk`. Markdown
template processing is disabled (`markdownTemplateEngine: false` in `eleventy.config.js`)
so stray `{{ }}`/`{% %}` in admin copy stays literal.

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
| `eleventy.config.js` | Dirs (`src` → `_site`), CSS passthrough, Markdown/HTML engines. |
| `project.json` | Nx targets: `build` (cached, `outputs: _site`), `serve`, `deploy` / `deploy-staging` (Worker). |
| `wrangler.toml` | Assets-only Worker config: prod name `www-worker` + `[env.staging]` name `staging-www`, `[assets] directory = _site`. |
| `src/content/about.md` | The admin-editable hero copy (pure Markdown). |
| `src/content/content.11tydata.json` | Applies the layout + `/` permalink to `about.md`. |
| `src/_includes/layout.njk` | Page shell: header, hero (renders `about.md`), CTA, how-it-works, footer. Loads PhotoSwipe CSS + `src/js/lightbox.js`. |
| `src/js/lightbox.js` | Initializes PhotoSwipe over the `.about` content images (click-to-zoom). |
| `src/_data/site.json` | Site name/tagline/description + `appUrl` (the app's host, used by all links). `appUrl` is generated from the repo-wide `config/domains.json` (`npm run sync:domains`; see root CLAUDE.md "Changing the domain") — don't hand-edit it. |
| `src/css/styles.css` | Warm, colorful brand styling (brown + gold + teal). |

## Build / serve

- `nx build www` → `apps/www/_site` (cached via Nx Cloud; `outputs` declared so remote
  cache restores instead of rebuilding when inputs are unchanged).
- `nx serve www` → local dev server with live reload.

**Monorepo hoisting**: `@11ty/eleventy` resolves from the *root* `node_modules`, not
`apps/www/node_modules`. The Nx targets call `npx @11ty/eleventy` so the binary resolves
regardless; keep any `addPassthroughCopy`/plugin paths relative to this project root.

## Deploy

Deployed as an **assets-only Cloudflare Worker** via `@naxodev/nx-cloudflare:deploy` (the same
executor as `apps/server` / `apps/login`), which runs `wrangler deploy` from this project root
and auto-discovers `wrangler.toml` here. There is no `main`/binding — wrangler serves the built
`_site` directly from the `[assets]` block. Both deploy targets `dependsOn: ["build"]`.

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
