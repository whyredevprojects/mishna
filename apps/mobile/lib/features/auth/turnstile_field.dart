import 'package:cloudflare_turnstile/cloudflare_turnstile.dart';
import 'package:flutter/material.dart';

import '../../core/config.dart';

/// The Cloudflare Turnstile widget the auth screens embed. The login worker's
/// captcha plugin requires its token (header `x-captcha-response`) on
/// sign-in/sign-up/password-reset. Tokens are single-use, so callers hold a
/// `GlobalKey<TurnstileFieldState>` and call [TurnstileFieldState.reset] after a
/// failed attempt to mint a fresh one.
class TurnstileField extends StatefulWidget {
  const TurnstileField({super.key, required this.onToken});

  /// Fired with a fresh token, or null when the token is reset/expired.
  final ValueChanged<String?> onToken;

  @override
  State<TurnstileField> createState() => TurnstileFieldState();
}

class TurnstileFieldState extends State<TurnstileField> {
  final _controller = TurnstileController();

  /// Invalidate the consumed token and request a new one.
  Future<void> reset() async {
    widget.onToken(null);
    await _controller.refreshToken();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Center(
      child: CloudflareTurnstile(
        siteKey: AppConfig.turnstileSiteKey,
        // The widget is bound to the production domain; anchoring the WebView
        // there satisfies Turnstile's domain validation.
        baseUrl: AppConfig.apiBaseUrl,
        controller: _controller,
        onTokenReceived: widget.onToken,
        onTokenExpired: () => widget.onToken(null),
        onError: (_) => widget.onToken(null),
      ),
    );
  }
}
