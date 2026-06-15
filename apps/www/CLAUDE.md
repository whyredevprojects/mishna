# apps/www

Public marketing site for Chevras Mishnayos — an [Eleventy (11ty)](https://www.11ty.dev)
static site deployed to Cloudflare Pages. This is the **apex** front door
(`getchevrasmishnayos.com`); the Angular app lives at `app.getchevrasmishnayos.com`,
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

## Layout

| Path | Role |
|------|------|
| `eleventy.config.js` | Dirs (`src` → `_site`), CSS passthrough, Markdown/HTML engines. |
| `project.json` | Nx targets: `build` (cached, `outputs: _site`), `serve`, `deploy` (Pages). |
| `src/content/about.md` | The admin-editable hero copy (pure Markdown). |
| `src/content/content.11tydata.json` | Applies the layout + `/` permalink to `about.md`. |
| `src/_includes/layout.njk` | Page shell: header, hero (renders `about.md`), CTA, how-it-works, footer. |
| `src/_data/site.json` | Site name/tagline/description + `appUrl` (the app's host, used by all links). |
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
