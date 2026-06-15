# Chevras Mishnayos Baal Peh — mobile app

Flutter app (Android + iOS) for the Mishna memorization program: sign in, pick a
weekly commitment, learn this week's mishnayos, track your whole-cycle portion,
review what you know, and get on-device reminders. It uses the same production
APIs as the website (`getchevrasmishnayos.com`); admin features are web-only.

See `CLAUDE.md` in this directory for architecture and design notes.

## Quick start

```sh
flutter pub get
flutter run        # against production
```

Mishna text comes bundled from the `mishna_text` pub package, which declares
its own Flutter assets — no extra step.

Against a local dev stack (`npm run dev` at the repo root, Android emulator):

```sh
flutter run \
  --dart-define=API_BASE_URL=http://10.0.2.2:8787 \
  --dart-define=TURNSTILE_SITE_KEY=1x00000000000000000000AA
```

## Checks

```sh
flutter analyze
flutter test
```

## Optional: native Google sign-in

Pass `--dart-define=GOOGLE_SERVER_CLIENT_ID=<apps/login GOOGLE_CLIENT_ID>` and
register the app's SHA-1 fingerprint as an Android OAuth client in the same
Google Cloud project. Until then the Google button is hidden and email/password
(plus email-based password reset) is the sign-in path.
