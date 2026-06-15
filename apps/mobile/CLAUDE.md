# apps/mobile

Flutter app (Android + iOS) covering the user-facing functionality of the Angular
client — sign-in/up, join the cycle, this week's mishnayos with learned check-off,
the whole-cycle "My Mishnayos" list + stats, the Review browser, and settings —
plus **on-device reminders** the web app doesn't have. Admin functionality is
deliberately excluded. It talks to the **same** production APIs
(`app.getchevrasmishnayos.com`): better-auth on `/api/auth/*`, the apps/server REST
surface on the rest of `/api/*`. Nothing in the JS/TS workspace changed for it.

Material 3, not a port of the web look-and-feel.

## Build-time config (`--dart-define`, see `lib/core/config.dart`)

The `API_BASE_URL` and `TURNSTILE_SITE_KEY` **defaults** in `config.dart` are generated
from the repo-wide `config/domains.json` (`npm run sync:domains`; see the root CLAUDE.md
"Changing the domain") — don't hand-edit those default strings. The `--dart-define`
overrides below are for pointing a dev build at a local server.

| Define | Default | Notes |
|---|---|---|
| `API_BASE_URL` | `https://app.getchevrasmishnayos.com` | Use `http://10.0.2.2:8787` against `npm run dev` from the Android emulator. |
| `TURNSTILE_SITE_KEY` | the production site key | Use Cloudflare's always-pass `1x00000000000000000000AA` in dev (dev server has no captcha secret, but the widget still wants to render). |
| `GOOGLE_SERVER_CLIENT_ID` | *(empty — Google button hidden)* | Set to apps/login's `GOOGLE_CLIENT_ID` (the web OAuth client id) to enable native Google sign-in; better-auth verifies the ID token's audience against it. |

## Architecture (`lib/`)

| Path | Role |
|---|---|
| `main.dart` | Bootstraps the persistent cookie jar, the timezone DB, and re-applies saved reminder schedules on every launch; injects both via ProviderScope overrides. |
| `app.dart` | Theme (M3, seed `#8a5a2b`) + splash-until-session-resolved + `MaterialApp.router`. |
| `router.dart` | go_router: public `/sign-in`, `/sign-up`, `/forgot-password`; a `StatefulShellRoute` bottom-nav shell for `/dashboard`, `/my-mishnayos`, `/review`, `/settings`. Redirects re-evaluate on every auth-state change (UX only — the server is the real boundary). |
| `core/` | `config.dart` (dart-defines), `api_client.dart` (Dio + `PersistCookieJar` + an interceptor that adds `Origin: <API_BASE_URL>` to non-GETs — better-auth's CSRF check rejects state-changing requests with a missing/untrusted Origin, and the API origin is in its `trustedOrigins`), `formatting.dart` (`formatRef` etc., mirrors the web util). |
| `data/` | `models.dart` (Dart shapes of the REST responses; `MishnaRef` has value equality), `repositories.dart` (`AuthRepository`, `MishnaApiRepository`, plus `FutureProvider`s — the TanStack-Query analog: cached until invalidated), `chaluka_view.dart` (pure grouping helpers, unit-tested), `mishna_text_store.dart` (loads tractate JSON from bundled assets, cached per tractate). |
| `features/auth/` | `auth_controller.dart` (`AsyncNotifier<Me?>` — sign-in/up/out, Google ID-token sign-in, invalidates data providers across user switches), the three auth screens, and `turnstile_field.dart` (the `cloudflare_turnstile` WebView widget; tokens are single-use so failed submits call `reset()`). |
| `features/dashboard/` | Join form (commitment choices from `GET /api/join-options`, each annotated with its approximate lot count, collapsing to a single "1 lot" option near the cycle end) or this week's mishna cards + cycle progress; pull-to-refresh. |
| `features/my_mishnayos/` | Tabs: Assignments (per-mesechta cards of collapsible rows, lazy text, learned checkboxes) and Stats (overall/per-mesechta progress). |
| `features/review/` | Mesechta/perek pickers over the chaluka, a mishna jump-strip (learned = highlighted), whole-perek text with one shared English toggle, last spot persisted (`review_spot.dart`). |
| `features/settings/` | Account card, server email prefs (timezone list from the bundled tz DB + detect, weekday dropdowns, enable switches → `PUT /api/me/preferences`), app reminders (below), leave-cycle (confirm dialog → `POST /api/leave`), log out. |
| `features/notifications/` | `notification_settings.dart` (local model + `SharedPreferences` persistence + an `AsyncNotifier` that keeps settings and schedules in lockstep, refusing an enable if the OS denies permission) and `notification_service.dart` (flutter_local_notifications: daily "memorize" at a chosen time, weekly "review" at a chosen day+time, calendar-matched in the device timezone, inexact Android scheduling — no exact-alarm permission). Schedules are re-applied on every launch and survive reboots (boot receiver in the manifest). |
| `widgets/` | `mishna_card.dart` (full card + disclosure row + `mishnaTextProvider` family so text loads once per ref), `completion_sync.dart` (mixin: optimistic toggle → sync → revert-on-failure → invalidate caches; screens re-seed via `ref.listen`), `cycle_progress_bar.dart`, `join_form.dart`. |

State management is plain Riverpod 3 (no codegen); models are hand-written
`fromJson` (small, stable API surface — not worth build_runner).

## Mishna text assets

The [`mishna_text`](https://pub.dev/packages/mishna_text) pub package
(**≥1.0.12** — 1.0.11's asset declaration was broken) is data-only and
**self-declares** its tractate JSON as Flutter assets (`flutter: assets: -
data/` over its root-level `data/`), so every consumer bundles them
automatically — this app's pubspec declares nothing and the repo vendors
nothing. Loaded via `rootBundle` as `packages/mishna_text/data/<file>`
(`lib/data/mishna_text_store.dart`); works offline, no network fetch like the
web client. `index.json` maps tractate names — the same Sefaria-style names
`MishnaRef.mesechta` carries ("Berakhot", "Pirkei Avot") — to file names.

The package is owned by this project's author — if it needs a change (layout,
declarations, data), **ask for a new release rather than working around it**.
Two gotchas from the 1.0.11 round: a package's self-declared asset paths
resolve against its package root (files under `lib/` don't yield the clean
`packages/<name>/<path>` keys), and `flutter test` can serve stale
`build/unit_test_assets` — delete that dir when asset changes don't show up.

## Auth notes

- **Session**: better-auth cookie, persisted by `PersistCookieJar` under the app
  documents dir, so sign-in survives restarts. `GET /api/me` 401 ⇒ signed out.
- **Captcha**: prod sign-in/sign-up/reset require a Turnstile token. The widget
  runs in a WebView anchored (`baseUrl`) to the API origin so the production
  site key's domain binding passes.
- **Origin header**: native requests carry no Origin; the Dio interceptor sends
  the API origin on non-GETs so better-auth's CSRF check passes (it's in
  `trustedOrigins`). No server change needed.
- **Google**: native `google_sign_in` → ID token → better-auth
  `sign-in/social { provider, idToken }`. Requires `GOOGLE_SERVER_CLIENT_ID`
  (and on Android, registering the app's SHA-1 fingerprints as an Android OAuth
  client in the same Google Cloud project). Hidden until configured.
- **Password reset** completes on the website (the email link targets the web
  `/reset-password` page); the app only requests the email.

## Android specifics

- `minSdk 23` (Turnstile WebView + google_sign_in), core-library desugaring on
  (flutter_local_notifications), `INTERNET` / `POST_NOTIFICATIONS` /
  `RECEIVE_BOOT_COMPLETED` permissions + the plugin's scheduled/boot receivers
  in the manifest.
- Release builds still sign with the debug key (`build.gradle.kts` TODO) —
  set up a real signing config before publishing.

## Verify

```sh
cd apps/mobile
flutter analyze        # or: nx analyze mobile
flutter test           # or: nx test-flutter mobile  (18 tests, incl. asset lookups)
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:8787 --dart-define=TURNSTILE_SITE_KEY=1x00000000000000000000AA
```

iOS builds need a Mac (this workspace is Windows); the iOS notification
permission flow is wired but untested on-device.
