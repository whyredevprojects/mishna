# apps/client

Angular frontend for the Mishna app (Cloudflare Pages target). Mobile-first: a
logged-in user's first screen is this week's mishnayot. Talks to `apps/server`'s REST
API and to `apps/login` (better-auth) for sign-in.

## Rendering model

Plain client-side-rendered SPA — no SSR. The build (`@angular/build:application`)
emits a browser-only bundle to `dist/apps/client/browser/`; `index.html` ships an
empty `<app-root>` shell that boots in the browser via `src/main.ts`. This suits an
interactive, authenticated app built on Web Awesome custom elements: no
prerender-time API calls (no cookies/server at build) and no shadow-DOM hydration
mismatches.

**Root-absolute asset URLs (`deployUrl: "/"`)** — the production build config in
`project.json` sets `deployUrl: "/"` so the eager `<script>` / `<link
rel="modulepreload">` / stylesheet URLs in `index.html` are emitted root-absolute
(`/main-*.js`, `/chunk-*.js`). **This is load-bearing, not cosmetic.** By default the
builder emits these *document-relative* and leans on `<base href="/">`; on a 2+-segment
deep route (`/admin/about`, `/admin/groups/:id`, `/my-mishnayos/stats`) a hard load whose
`<base>` isn't honored (e.g. an edge/SW-cached shell) resolves `chunk.js` against the
`/admin/` *directory* → `/admin/chunk-*.js`, which Cloudflare Pages answers with the SPA
`index.html` as `text/html` (and a 4h `max-age`), so the browser rejects HTML-as-a-module
and ngsw chokes. Leading-slash URLs resolve to the origin root from any path, sidestepping
this entirely and aligning with the ngsw manifest keys. (Static assets like `favicon.ico`
/ `manifest.webmanifest` stay relative — non-critical, still resolved via `<base href>`.)
A residual hardening worth doing: make Pages return a real `404` for asset-looking misses
instead of the SPA shell (see `TODO.md`).

## i18n / Hebrew (RTL)

Localized with **build-time `@angular/localize`**. English is the source locale, served
at the site root (`/`); Hebrew is a **separate build** served under `/he/`. Two builds
(not one multi-output build) because each locale needs its own `deployUrl` — the English
build sets `deployUrl: "/"` (load-bearing, see **Rendering model** above) and the Hebrew
build sets `deployUrl: "/he/"` so its eager `<script>`/`<link>` URLs and ngsw manifest
keys are `/he/…`-absolute.

- **Config lives in `project.json`.** The top-level `i18n` block maps locale `he` →
  `src/locale/messages.he.xlf` with `baseHref: "/he/"`. Build config **`production-he`**
  sets `localize: ["he"]`, `deployUrl: "/he/"`, `outputPath: dist/apps/client-he`,
  `index: src/index.he.html`, `serviceWorker: ngsw-config.he.json`, and
  `i18nMissingTranslation: "error"` (a missing Hebrew target fails the build — this is the
  completeness gate). `development-he` + serve config `he` mirror it for `nx serve`. The
  `@angular/localize/init` polyfill is in the base `build` options so `$localize` exists in
  the untranslated English build and under dev-serve (localize inlining is off there).
- **Per-locale shells/configs**: `src/index.he.html` (`<html lang="he" dir="rtl">`, Hebrew
  head), `public/manifest.he.webmanifest` (scope/start_url `/he/`), `ngsw-config.he.json`
  (a copy of `ngsw-config.json` **without** the `!/he/**` navigation exclusion — the
  generator joins the `/he/` baseHref onto index/asset paths automatically). The root
  `ngsw-config.json` **excludes** `/he/**` from its navigationUrls so the English SW never
  claims Hebrew routes. `public/_headers` adds no-cache for the `/he/` ngsw + manifest.
- **`public/_redirects` is coupled to `app.routes.ts`.** Cloudflare Pages evaluates
  `_redirects` before static assets, so we can't use a blanket `/he/* → /he/index.html`
  rewrite (it would swallow the hashed assets). Instead we **enumerate route-shaped paths**
  under `/he/`. **Any new client route must be added there** (English uses Pages' built-in
  SPA fallback). A missing `/he/` path isn't just cosmetic: Pages serves the English shell
  there, which demotes a Hebrew-preferring user to English and hides the toggle for the tab
  session (`main.ts`'s `inHe && !IS_HEBREW` guard).
- **Locale-aware code** (`util/locale.ts`): `CURRENT_LOCALE`/`IS_HEBREW` derive from
  `$localize.locale`; `localizePath(p)` prefixes `/he` in the Hebrew build (used for OAuth
  `callbackURL` + password-reset `redirectTo` so auth returns into the right build).
  Hebrew domain text (mishna text, `tractateHebrewName`) needs no translation, but the
  API's English (transliterated) mesechta names do: `util/mesechta-hebrew-names.ts` is a
  generated `nameEn → nameHe` map (exhaustiveness pinned by its `.spec.ts` against
  `@mishna/domain`'s `mishnahDataset`), consumed by `formatRefLocalized()` in `util/format.ts`.
  `MishnaTextService` derives its tractate-JSON base from `document.baseURI` so it fetches
  `/he/*.json` (SW-cached) under Hebrew. RTL: styles already use logical properties + Web
  Awesome handles RTL; directional icons opt in with `class="dir-flip"` (global rule in
  `styles.scss`), and the English translation paragraph in `mishna-card` is pinned `dir="ltr"`.
- **Switcher + persistence**: `app-shell` and `site-header` render a language toggle whose
  label is the *other* language's own name (rendered outside the i18n pipeline). On click it
  writes `localStorage.preferredLocale` and does a full-page `location.assign` to the matching
  path. `main.ts` reads `preferredLocale` **before** bootstrap and redirects to the matching
  build (guarded against loops). Ships in both builds.
- **Translation workflow**: `nx extract-i18n client` regenerates `src/locale/messages.xlf`
  (XLIFF 2, source). Copy new units into `messages.he.xlf` (set `trgLang="he"`, add a
  `<target>` per `<segment>`, preserve `<ph>`/ICU placeholders, never edit ids). The
  `production-he` build fails on any missing target. Units without explicit `@@` ids get
  content-hash ids, so editing an English source string orphans its Hebrew `<target>` —
  re-run `nx extract-i18n client` and update `messages.he.xlf` in the same commit (CI's
  `production-he` build now catches misses).
- **Admin stays English/unmarked by design** (`pages/admin*`), as does Hebrew domain content.

### Testing the language toggle locally

`nx serve client` only serves the **English** build (localize inlining is off under
dev-serve and there's no `/he/` output), so the toggle can't reach a real Hebrew
bundle there. Angular's dev-server serves **one locale at a time by design** — there is
no live single-server "both locales" mode. The standard way to exercise both together is
to build each locale and static-serve the merged output. That's wrapped in one command:

```
npm run dev:i18n      # = nx serve-i18n client
```

The `serve-i18n` target in `project.json` runs the same merge the `deploy` target does
(build English → build `production-he` → `rm -rf` the old `/he` → `cp -r` the new one),
then serves `dist/apps/client/browser` on `:4200` via **`wrangler pages dev`** — the same
Cloudflare Pages runtime as prod, so it applies `public/_headers` (no-cache for the `/he/`
ngsw + manifest), the English SPA fallback, and the `/he → /he/` redirect from
`public/_redirects`. That's closer to prod than a bare static server
(`python3 -m http.server`, which ignores both). The `rm -rf` before the `cp -r` keeps
re-runs idempotent — without it the copy nests into `he/he`. A fixed
`--compatibility-date` is passed because `wrangler pages dev` otherwise defaults to
*today*, which can exceed the bundled workerd runtime and fail to start.

One local-only caveat: `wrangler pages dev` mishandles the `_redirects` **`200` rewrite**
rules, so a hard refresh on a deep `/he/<route>` (e.g. `/he/dashboard`) 308-redirects to
`/he/` instead of serving the Hebrew shell inline as real Pages does. Client-side
navigation (landing on `/he/` and routing within Angular) is unaffected — this only shows
up on a direct hit/refresh of a deep `/he/` URL. For the locale/RTL/toggle checks this
target is for, that doesn't matter.

This mirrors production (English at `/`, Hebrew merged in under `/he/`). Scope is
locale/RTL/toggle verification: like the manual method, and unlike `nx serve client`
(which proxies `/api` → `:8787`), the merged static serve does **not** proxy the API, so
backend-hitting flows (login, dashboard data) need the `server`/`login` workers running
separately.

`nx serve client --configuration=he` **does** serve the Hebrew bundle (at `/he/`) for
visual/RTL checks, but it can't round-trip the `/ ↔ /he/` toggle on a single origin —
that's specifically what the merged build above is for.

Note the dev behavior: in a plain `nx serve client`, clicking **עברית** will briefly
navigate to `/he/` then normalize **back to English** — the Hebrew bundle isn't served
in dev, so `main.ts` detects the English shell at a `/he` path, returns to `/`, and
sets a session flag (`sessionStorage.heBundleUnavailable`) that hides the toggle and
suppresses further `/he` redirects for the rest of the tab. This is expected (no
bounce/loop); use the merged-build method above to actually see Hebrew. Relatedly, with
`preferredLocale=he` persisted in localStorage, each **new** tab replays a single
`/ → /he/ → /` redirect hop before the session flag settles it — also expected, not a
bounce/loop.

## PWA / offline

Installable PWA backed by the Angular service worker (NGSW). The goal is that a
user who has opened the app once can reopen it later — even fully offline — and
still see their last-seen quota, settings, today's assignment and any mishna text
they've already viewed. Offline is **read-only**: NGSW only intercepts `GET`, so
check-off / join / leave (`POST`/`DELETE`) just fail offline (optimistic UI
reverts + danger toast), which is the intended behavior.

- **Manual wiring (no `ng add @angular/pwa`)** — the `@angular/pwa` schematic
  targets `angular.json`, not this Nx `project.json` workspace, so its six steps
  were replicated by hand.
- `provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(), registrationStrategy: 'registerWhenStable:30000' })`
  in `app.config.ts` — **disabled under `nx serve`**, on only in production builds.
  Build emits the SW via the `serviceWorker` option in `project.json`'s
  `production` config.
- `ngsw-config.json` (project root): `assetGroups` prefetch the app shell
  (`index.html`/CSS/JS/`manifest`), lazily cache `/icons` + media, and lazily
  cache the 64 `mishna-text` tractate JSONs (`/*.json`) — cache-on-view so only
  opened tractates are stored (the full set is ~7 MB). The `api-data` `dataGroup`
  caches the read endpoints (`/api/me`, `/api/me/chaluka`, `/api/cycle`,
  `/api/assignments[?...]`, `/api/completions`) with `strategy: freshness`,
  `timeout: 3s`, `maxAge: 30d`:
  network-first when online, last snapshot when offline. **`/api/auth/*` is
  deliberately not cached.**
- `public/manifest.webmanifest` + `public/icons/*` (placeholder brand book icon,
  `#8a5a2b`; replace with real art by overwriting the PNGs). Head tags
  (`manifest`, `theme-color`, `apple-touch-icon`) live in `index.html`.
- `public/_headers` sets `Cache-Control: no-cache` on `ngsw.json` /
  `ngsw-worker.js` / `manifest.webmanifest` so Cloudflare Pages rolls out deploys
  promptly (hashed bundles keep the default long cache).
- `services/sw-recovery.service.ts` (`SwRecoveryService`) owns **all** SW lifecycle
  handling, wired at the app root via `provideAppInitializer` in `app.config.ts` so it
  runs always-on (independent of route/auth — not in a component). It: shows the "new
  version available — Reload" toast on `VERSION_READY`; and **self-heals a stranded
  client** — on `SwUpdate.unrecoverable`, or a failed lazy-chunk load (router
  `withNavigationErrorHandler` + a global `error`/`unhandledrejection` listener,
  matched by `isChunkLoadError`), it does a `sessionStorage`-guarded one-shot
  `location.reload()` onto the fresh shell. Guard against loops: a single
  `sw-recovery-reloaded` flag covers every forced-reload path. This fixes returning
  users stuck on a stale shell whose dead `/admin/*` chunks come back as
  `200 text/html` (Pages SPA fallback) and get blocked by `nosniff`.
- **Testing**: NGSW does not run under `nx serve`. Build, then serve the
  `dist/apps/client/browser` output statically (e.g. `python3 -m http.server`)
  and open in an incognito window; toggle DevTools → Network → Offline to verify.

## Web Awesome

UI is built with [Web Awesome](https://webawesome.com) web components (`wa-*`).

- The theme CSS is loaded via the build's `styles` array (`project.json`).
- The component definitions are imported in **`main.ts` only** (the browser
  entry) — `customElements.define` touches `HTMLElement`, absent during Node SSR.
- Every component template that uses `wa-*` tags declares
  `schemas: [CUSTOM_ELEMENTS_SCHEMA]`.
- Booleans are set with `[attr.foo]="cond ? '' : null"` (presence = on); state is
  resynced from WA close events like `(wa-after-hide)`.
- Icons (`<wa-icon>`) load Font Awesome Free over the network by default.

## Captcha (Cloudflare Turnstile)

The sign-in (`landing`), sign-up (`join`) and forgot-password pages render a
`<app-turnstile>` widget (`components/turnstile.component.ts`) and pass its token to
the matching `AuthService` call, which sends it as the `x-captcha-response` header.
The login worker's captcha plugin verifies it server-side (see `apps/login`).

- `TurnstileComponent` lazily injects Cloudflare's `api.js` once per document
  (explicit render), exposes the token via a `(verified)` output + `token` signal,
  and a `reset()` method. **Tokens are single-use**, so each page calls
  `reset()` in its request's error handler (e.g. wrong password) to get a fresh one
  for the retry; the submit button stays disabled until a token exists.
- The **public** site key comes from `environments/environment.ts`
  (`turnstileSiteKey`) — the one place this app uses Angular's standard
  environment-file pattern. `environment.ts` holds the real **production** key;
  the `development` build config swaps in `environment.development.ts` (Cloudflare's
  always-pass *test* key) via `fileReplacements` in `project.json`, so `nx serve`
  works on any hostname. The secret key lives in `apps/login`.

## Layout (`src/app/`)

| Path | Role |
|------|------|
| `app.ts` | Root: a bare `<router-outlet>`. |
| `app.routes.ts` | `/` = landing, `/join`, `/forgot-password`, `/reset-password` (all public). `/dashboard`, `/my-mishnayos`, `/review`, `/settings`, `/admin` are children of `AppShellComponent`, gated by `authGuard` and lazy-loaded. `/my-mishnayos` is a shell (sub-nav + outlet) with children `''` (Assignments) and `stats`; old `/chaluka` redirects here. `/admin` is a shell (sub-nav + outlet) further gated by `adminGuard`, with children `''` (Overview), `users` + `users/:id`, `groups` + `groups/:id`, `assignments`, `about`. |
| `ui/` | In-app reusable presentational components: `app-data-table` (column defs + a projected `#cell` template; owns the table chrome, hover, horizontal scroll) and `app-paginator` (server-side pager, "X–Y of N" + prev/next). Deliberately thin — the seam to swap in a headless table (e.g. TanStack Table) later without touching pages. |
| `guards/auth.guard.ts` | Confirms a session via `GET /api/me`; redirects to `/` otherwise. UX only — the server API is the real auth boundary. |
| `guards/admin.guard.ts` | Loads `GET /api/me` and allows only when `isAdmin`, else redirects to `/dashboard`. UX only — the server's `requireAdmin` is the boundary. |
| `models/api.types.ts` | Client shapes of the server responses; reuses `@mishna/domain` value types, redefines anything carrying a `Date` (arrives as ISO string). |
| `services/` | One thin service per API area (see below) — they own the URLs only. |
| `queries/` | TanStack Query layer: `query-keys.ts` (cache-key registry) + `queries.ts` (`queryOptions` factories that wrap the service observables). See **Data caching** below. |
| `components/` | Reusable pieces: `app-shell` (top bar + nav drawer + leave dialog), `cycle-progress`, `mishna-card` (one mishna's text + English toggle + optional learn checkbox; an opt-in `collapsible` mode renders a compact disclosure row whose heading toggles the text and lazy-loads it on first expand, with the learn checkbox/status tag as a sibling of the heading so toggling it doesn't expand the row), `today-card` (the shown bucket's mishnayos; the `dashboard` page wraps it in a **bucket pager** — prev/next arrows + touch-swipe that step the user's portion relative to their *current* (next-unlearned) bucket. A `bucket` signal (`null` = current `/today`, else an explicit `?bucket=N`) drives the query with `keepPreviousData`; prev/next step from the served index the response reports, bounded by bucket 0 and the last bucket. Mirror any change in `apps/mobile`), `join-form` (commitment picker driven by `GET /api/join-options`: each weekly pace shows its approximate lot count, collapsing to a single "1 lot" option near the cycle end). |
| `pages/` | Routed screens: `landing`, `join`, `forgot-password` + `reset-password` (public password-reset flow, backed by better-auth/Resend in `apps/login`), `dashboard`, `review`, `settings`, the "My Mishnayos" shell `my-mishnayos` + its `my-mishnayos-assignments` (whole-cycle portion as a per-mesechta list; each mishna is a collapsible `mishna-card` that expands its text inline on click and has a learn checkbox — optimistic toggle synced via `POST`/`DELETE /api/completions` with the per-ref `groupId` from `chaluka.groupIds`, reverting on failure like the Today view) and `my-mishnayos-stats` (overall progress + stats + per-mesechta breakdown) tabs, and the admin shell `admin` + `admin-overview`, `admin-users` (paginated/searchable), `admin-user-detail`, `admin-groups` + `admin-group-detail`, `admin-assignments`, and `admin-about` (a Toast UI Markdown editor for the `apps/www` site's about copy — see below). Admin lists use `ui/` (`app-data-table` + `app-paginator`) with server-side paging (≤50/page). |
| `util/format.ts` | `formatRef` ("Berachos 1:1"), `toIsoDate`, `formatLongDate` (UTC). |

## Services → API

| Service | Calls |
|---------|-------|
| `AuthService` | `GET /api/me` (session + join status + identity + `isAdmin`), better-auth `sign-in/email`, `sign-up/email`, `sign-in/social`, `sign-out`, and password reset (`request-password-reset` + `reset-password`). Holds a `me` signal; `isAdmin()` reads it. `sign-in/email`, `sign-up/email` and `request-password-reset` take a Cloudflare Turnstile token, sent as the `x-captcha-response` header the login worker's captcha plugin validates (see **Captcha** below). |
| `CycleService` | `GET /api/cycle` (public). |
| `AssignmentService` | `GET /api/assignments/today` (current/next-unlearned bucket), `GET /api/assignments?bucket=` (an explicit pager bucket), `GET /api/me/chaluka` (whole-cycle portion + learned subset), `GET /api/completions`, `POST`/`DELETE /api/completions`. |
| `GroupService` | `GET /api/join-options` (signup choices + lot estimates), `POST /api/join`, `POST /api/leave`. |
| `SettingsService` | `GET`/`PUT /api/me/preferences` (timezone + reminder schedule). |
| `AdminService` | `GET /api/admin/stats`, `GET /api/admin/groups`, `GET /api/admin/groups/:id`, `GET /api/admin/lots` (static lot catalog for the group-detail editor), `POST /api/admin/groups/:groupId/members/:userId/lots` (set a member's lots), `GET /api/admin/users` (paged: `limit`/`offset`/`search`/`sort`), `GET /api/admin/users/:id`, `GET /api/admin/assignments` (paged, by `week`), `POST /api/admin/users/:id/remove-assignments`, `POST`/`DELETE /api/admin/users/:id/completions` (admin learn/unlearn), `POST /api/admin/users/:id/send-weekly`, `POST /api/admin/users/:id/send-reminder`, `POST /api/admin/users/:id/send-verification` (resend the verification email to a pending user), `DELETE /api/admin/users/:id`, `GET`/`POST /api/admin/about?locale=en\|he` (read/commit the `apps/www` site's about Markdown per locale), `POST /api/admin/about/image` (upload an editor image to R2, returns its public URL). |

## Data caching (TanStack Query)

Reads go through [`@tanstack/angular-query-experimental`](https://tanstack.com/query)
for in-memory caching + request dedup, so navigating between routes reuses data
instead of re-fetching. The `QueryClient` is provided in `app.config.ts` (defaults:
`staleTime` 30s, `gcTime` 5min); per-query overrides live in `queries/queries.ts`
(e.g. `cycle` 1h, admin views 0).

- **Services stay thin** — they only know URLs. The `queries/` factories wrap each
  service observable as a `queryFn` (via `firstValueFrom`). Add a new endpoint by
  adding a key in `query-keys.ts` and a factory in `queries.ts`, then consume it.
- **Reads**: components call `injectQuery(() => xQueryOptions(svc, ...))` and read the
  result signals (`q.data()`, `q.isPending()`/`isLoading()`, `q.isError()`). For
  reactive params the key is a function of a signal.
- **Guards** resolve `me` via `queryClient.ensureQueryData(meQueryOptions(auth))`, so
  `authGuard` + `adminGuard` + the dashboard dedup to one `GET /api/me` per nav burst.
- **Writes** use `injectMutation` and invalidate the affected keys in `onSuccess`
  (join/leave → `me` + `assignmentToday`; completions toggle → `assignmentToday`,
  optimistic via `onMutate`/`onError`; admin actions → the admin keys).
- **Cache coherence**: anything that changes auth state must update the `me` cache —
  sign-in/sign-up invalidate `me` (so the guard re-fetches), and `AuthService.signOut()`
  calls `queryClient.clear()` so the next user never sees the prior session's data.
- `AuthService.me` signal is still populated as a side effect of `loadSession()`'s
  `tap`, so `isAdmin()` and `auth.me()` keep working off the cached fetch.

All calls use **relative `/api/*`** (no per-environment API base — the only thing
`environments/` carries is the Turnstile site key), which works in both
environments because the API is always same-origin:
- **Dev**: `proxy.conf.json` forwards `/api` to the server worker on `:8787`.
- **Prod**: the SPA serves from `app.getchevrasmishnayos.com` (Pages custom domain), and
  Cloudflare Worker `routes` claim `/api/*` on that same host — `/api/auth/*` → the
  login worker, the rest of `/api/*` → the server worker. Same origin means the
  better-auth session cookie is first-party; no CORS, no client config.

## Known gaps / follow-ups

- **Auth**: `signInWithGoogle()` posts to better-auth's `sign-in/social`. The
  `google` provider is **not yet configured** in `apps/login` (and dev only
  proxies one worker), so sign-in won't complete end-to-end until that's wired.
- **Completion tracking**: `TodayCardComponent` syncs each "learned" toggle to
  `apps/server` (`POST`/`DELETE /api/completions`, with the assignment's `groupId`),
  optimistically updating and reverting on failure. `DashboardComponent` seeds the
  initial state from `GET /api/completions`. A failed sync surfaces a transient danger
  toast via `ToastService` (an imperative `wa-callout`, since Web Awesome has no toast
  component). Reads are offline-capable (see **PWA / offline**), but offline
  check-off + reconnect sync is deferred — see root `TODO.md`.
- **Review**: a per-perek review browser over the user's whole-cycle portion
  (`GET /api/me/chaluka`). A sticky header has mesechta + perek selectors (populated
  from the allotment) and a mishna strip showing which mishnayos are learned (dimmed
  when not yet); the whole perek renders as reused `mishna-card`s (`showCheckbox=false`).
  Clicking a strip number scrolls to that mishna. The last spot is persisted in
  localStorage (`util/review-storage.ts`) and restored (and scrolled to) on return.
- **Settings**: `settings.component.ts` edits email prefs — timezone (`wa-select`
  populated from `Intl.supportedValuesOf('timeZone')`, with a "Detect" button using
  `Intl.DateTimeFormat().resolvedOptions().timeZone`), the weekly/reminder weekday
  selects, and enable checkboxes. Save → `SettingsService.updatePreferences` + a toast.
- **Admin send-now**: `admin-user-detail.component.ts` has "Send weekly"/"Send reminder"
  buttons (`AdminService.sendWeekly`/`sendReminder`) that queue an extra email, with a
  success/error toast. `ToastService` now has `success()` alongside `error()`.
- **Admin lot editing**: `admin-group-detail.component.ts` shows each member's lots as
  `54 (Peah:1), …` (labels from the cached `GET /api/admin/lots` catalog) and a pencil
  opens inline numeric inputs (add/remove/Enter-to-add) with a "?" lot-reference dialog.
  Save posts to `AdminService.setMemberLots`; a member already holding a typed lot is
  flagged inline (double-assignment is allowed — see `apps/server`). One row edits at a
  time; the catalog query is long-lived (`adminLotsQueryOptions`, static data).
- **Weekly-goal (commitment) editing** is intentionally **not** offered yet: changing it
  mid-cycle would require re-allocation (a new block). Deferred until requested.
- **About-page editor** (`admin-about.component.ts`): wraps the
  [Toast UI](https://ui.toast.com/toast-ui-editor) Markdown editor (`@toast-ui/editor`, a
  vanilla-JS lib) to edit the `apps/www` marketing site's intro copy. An English/עברית
  `wa-button-group` toggle (a `locale` signal) picks which locale's `about.md` is edited;
  the query is keyed per locale (`adminAbout(locale)`), so each caches separately. The
  editor is created in `ngAfterViewInit` against a `viewChild` host and `destroy()`ed in
  `ngOnDestroy`; the fetched Markdown is seeded via an `effect` that re-seeds whenever the
  locale switches (tracked by `seededLocale`, not a one-shot boolean) — switching discards
  unsaved edits in the current locale (save is explicit). Save reads `getMarkdown()` →
  `AdminService.saveAbout(locale, …)` (commits via the server's GitHub Contents proxy to
  that locale's file). Pasted/dropped images go through
  `addImageBlobHook` → client-side downscale (~1600px webp) → `AdminService.uploadAboutImage`
  (raw body to the R2-backed Worker endpoint) → inserted as a plain `![](url)`. The
  package's `exports` map omits a `types` condition, so a minimal ambient declaration
  lives at `src/types/toast-ui-editor.d.ts`. The whole component (incl. the editor + its
  CSS) is a lazy chunk, so it never touches the initial bundle. **Server-side TODOs**
  (R2 bucket, `GITHUB_TOKEN`) are tracked in `apps/server`; until they're set the editor
  surfaces a clear error on load/save rather than failing silently.

## Verify

- `nx build client`, `nx lint client`, `nx test client`.
- `nx serve client` (depends on `server:serve`) → http://localhost:4200.
- Service worker / offline: build, then serve `dist/apps/client/browser`
  statically (NGSW is off under `nx serve`) and test in an incognito window.
