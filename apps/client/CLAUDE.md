# apps/client

Angular frontend for the Mishna app (Cloudflare Pages target). Mobile-first: a
logged-in user's first screen is today's mishnayot. Talks to `apps/server`'s REST
API and to `apps/login` (better-auth) for sign-in.

## Rendering model

Plain client-side-rendered SPA — no SSR. The build (`@angular/build:application`)
emits a browser-only bundle to `dist/apps/client/browser/`; `index.html` ships an
empty `<app-root>` shell that boots in the browser via `src/main.ts`. This suits an
interactive, authenticated app built on Web Awesome custom elements: no
prerender-time API calls (no cookies/server at build) and no shadow-DOM hydration
mismatches.

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

## Layout (`src/app/`)

| Path | Role |
|------|------|
| `app.ts` | Root: a bare `<router-outlet>`. |
| `app.routes.ts` | `/` = landing (public). `/dashboard`, `/review`, `/settings`, `/admin` are children of `AppShellComponent`, gated by `authGuard` and lazy-loaded. `/admin` is a shell (sub-nav + outlet) further gated by `adminGuard`, with children `'' ` (groups), `users`, `users/:id`. |
| `guards/auth.guard.ts` | Confirms a session via `GET /api/me`; redirects to `/` otherwise. UX only — the server API is the real auth boundary. |
| `guards/admin.guard.ts` | Loads `GET /api/me` and allows only when `isAdmin`, else redirects to `/dashboard`. UX only — the server's `requireAdmin` is the boundary. |
| `models/api.types.ts` | Client shapes of the server responses; reuses `@mishna/domain` value types, redefines anything carrying a `Date` (arrives as ISO string). |
| `services/` | One thin service per API area (see below). |
| `components/` | Reusable pieces: `app-shell` (top bar + nav drawer + leave dialog), `cycle-progress`, `mishna-list`, `today-card`, `join-form`. |
| `pages/` | Routed screens: `landing`, `dashboard`, `review`, `settings`, and the admin shell `admin` + `admin-groups`, `admin-users`, `admin-user-detail`. |
| `util/format.ts` | `formatRef` ("Berachos 1:1"), `toIsoDate`, `formatLongDate` (UTC). |

## Services → API

| Service | Calls |
|---------|-------|
| `AuthService` | `GET /api/me` (session + join status + identity + `isAdmin`), better-auth `sign-in/social` + `sign-out`. Holds a `me` signal; `isAdmin()` reads it. |
| `CycleService` | `GET /api/cycle` (public). |
| `AssignmentService` | `GET /api/assignments/today`, `GET /api/assignments?date=`, `GET /api/completions`, `POST`/`DELETE /api/completions`. |
| `GroupService` | `POST /api/join`, `POST /api/leave`. |
| `AdminService` | `GET /api/admin/groups`, `GET /api/admin/users`, `GET /api/admin/users/:id`, `POST /api/admin/users/:id/remove-assignments`, `DELETE /api/admin/users/:id`. |

All calls use **relative `/api/*`** (no `environment.ts`), which works in both
environments because the API is always same-origin:
- **Dev**: `proxy.conf.json` forwards `/api` to the server worker on `:8787`.
- **Prod**: the SPA serves from `getchevrasmishnayos.com` (Pages custom domain), and
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
  component). Offline check-off + reconnect sync is deferred — see root `TODO.md`.
- **Review**: currently the date-picker browser (any day's assignment). The
  per-perek completion view in the UI plan is deferred (needs completions data).

## Verify

- `nx build client`, `nx lint client`, `nx test client`.
- `nx serve client` (depends on `server:serve`) → http://localhost:4200.
