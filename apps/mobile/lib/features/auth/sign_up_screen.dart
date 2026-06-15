import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/config.dart';
import 'auth_controller.dart';
import 'turnstile_field.dart';

/// Public signup: creates the account (email/password or Google), after which
/// the router lands on the dashboard, where the commitment picker runs.
class SignUpScreen extends ConsumerStatefulWidget {
  const SignUpScreen({super.key});

  @override
  ConsumerState<SignUpScreen> createState() => _SignUpScreenState();
}

class _SignUpScreenState extends ConsumerState<SignUpScreen> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _turnstileKey = GlobalKey<TurnstileFieldState>();
  String? _captchaToken;
  String? _error;
  bool _loading = false;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _createAccount() async {
    final token = _captchaToken;
    if (_loading || token == null) return;
    setState(() {
      _error = null;
      _loading = true;
    });
    final error = await ref.read(authControllerProvider.notifier).signUpWithEmail(
          _name.text.trim(),
          _email.text.trim(),
          _password.text,
          captchaToken: token,
        );
    if (!mounted) return;
    setState(() {
      _loading = false;
      _error = error;
    });
    if (error != null) {
      setState(() => _captchaToken = null);
      await _turnstileKey.currentState?.reset();
    }
  }

  Future<void> _joinWithGoogle() async {
    if (_loading) return;
    setState(() {
      _error = null;
      _loading = true;
    });
    final error =
        await ref.read(authControllerProvider.notifier).signInWithGoogle();
    if (!mounted) return;
    setState(() {
      _loading = false;
      _error = error;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Join the Program')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: _name,
                    autofillHints: const [AutofillHints.name],
                    decoration: const InputDecoration(labelText: 'Name'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.email],
                    decoration: const InputDecoration(labelText: 'Email'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _password,
                    obscureText: true,
                    autofillHints: const [AutofillHints.newPassword],
                    decoration: const InputDecoration(labelText: 'Password'),
                    onSubmitted: (_) => _createAccount(),
                  ),
                  const SizedBox(height: 16),
                  TurnstileField(
                    key: _turnstileKey,
                    onToken: (token) => setState(() => _captchaToken = token),
                  ),
                  if (_error case final e?) ...[
                    const SizedBox(height: 8),
                    Text(e, style: TextStyle(color: theme.colorScheme.error)),
                  ],
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _captchaToken == null || _loading
                        ? null
                        : _createAccount,
                    child: _loading
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Create account'),
                  ),
                  if (AppConfig.googleSignInEnabled) ...[
                    const Divider(height: 32),
                    OutlinedButton.icon(
                      onPressed: _loading ? null : _joinWithGoogle,
                      icon: const Icon(Icons.login),
                      label: const Text('Join with Google'),
                    ),
                  ],
                  const SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Text('Already have an account?'),
                      TextButton(
                        onPressed: () => context.go('/sign-in'),
                        child: const Text('Log in'),
                      ),
                    ],
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
