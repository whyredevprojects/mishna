import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/repositories.dart';
import 'turnstile_field.dart';

/// Requests a password-reset email. The emailed link opens the website's
/// /reset-password page, so the reset itself completes in the browser.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() =>
      _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _email = TextEditingController();
  final _turnstileKey = GlobalKey<TurnstileFieldState>();
  String? _captchaToken;
  String? _error;
  bool _loading = false;
  bool _sent = false;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final token = _captchaToken;
    if (_loading || token == null) return;
    setState(() {
      _error = null;
      _loading = true;
    });
    try {
      await ref
          .read(authRepositoryProvider)
          .requestPasswordReset(_email.text.trim(), captchaToken: token);
      if (!mounted) return;
      setState(() {
        _loading = false;
        _sent = true;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Could not send the reset email. Please try again.';
        _captchaToken = null;
      });
      await _turnstileKey.currentState?.reset();
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Reset password')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: _sent
                  ? Column(
                      children: [
                        const Icon(Icons.mark_email_read_outlined, size: 48),
                        const SizedBox(height: 16),
                        Text(
                          'If an account exists for that address, a reset '
                          'link is on its way. Open it on this device or any '
                          'browser to choose a new password.',
                          style: theme.textTheme.bodyLarge,
                          textAlign: TextAlign.center,
                        ),
                      ],
                    )
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          "Enter your email and we'll send you a link to "
                          'reset your password.',
                          style: theme.textTheme.bodyLarge,
                        ),
                        const SizedBox(height: 16),
                        TextField(
                          controller: _email,
                          keyboardType: TextInputType.emailAddress,
                          autofillHints: const [AutofillHints.email],
                          decoration:
                              const InputDecoration(labelText: 'Email'),
                          onSubmitted: (_) => _send(),
                        ),
                        const SizedBox(height: 16),
                        TurnstileField(
                          key: _turnstileKey,
                          onToken: (token) =>
                              setState(() => _captchaToken = token),
                        ),
                        if (_error case final e?) ...[
                          const SizedBox(height: 8),
                          Text(
                            e,
                            style: TextStyle(color: theme.colorScheme.error),
                          ),
                        ],
                        const SizedBox(height: 16),
                        FilledButton(
                          onPressed:
                              _captchaToken == null || _loading ? null : _send,
                          child: _loading
                              ? const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Text('Send reset link'),
                        ),
                      ],
                    ),
            ),
          ),
        ),
      ),
    );
  }
}
