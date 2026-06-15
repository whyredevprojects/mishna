/// Build-time configuration, supplied via `--dart-define` with production
/// defaults. The API is the same apps/server REST surface the web client uses;
/// auth (`/api/auth/*`) is better-auth on the same host.
class AppConfig {
  AppConfig._();

  /// Origin the app talks to. Point at a dev tunnel/host with
  /// `--dart-define=API_BASE_URL=http://10.0.2.2:8787` (Android emulator).
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://getchevrasmishnayos.com',
  );

  /// Cloudflare Turnstile *public* site key. Defaults to the production widget
  /// (bound to getchevrasmishnayos.com — the Turnstile WebView is anchored to
  /// that domain via its baseUrl). Override with Cloudflare's always-pass test
  /// key `1x00000000000000000000AA` against a dev server with no captcha secret.
  static const turnstileSiteKey = String.fromEnvironment(
    'TURNSTILE_SITE_KEY',
    defaultValue: '0x4AAAAAADhFwbhDJNP7CeZY',
  );

  /// The *web* OAuth client id better-auth is configured with (apps/login's
  /// GOOGLE_CLIENT_ID). google_sign_in uses it as the audience of the ID token
  /// it mints, which better-auth then verifies on `sign-in/social`. Empty
  /// (the default) hides the Google sign-in button.
  static const googleServerClientId = String.fromEnvironment(
    'GOOGLE_SERVER_CLIENT_ID',
    defaultValue: '',
  );

  static bool get googleSignInEnabled => googleServerClientId.isNotEmpty;
}
