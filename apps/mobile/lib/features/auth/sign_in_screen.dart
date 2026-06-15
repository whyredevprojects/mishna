import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/config.dart';
import '../../data/repositories.dart';
import '../../widgets/cycle_progress_bar.dart';
import 'auth_controller.dart';
import 'turnstile_field.dart';

/// Public landing: tagline, cycle progress, email/password sign-in, Google
/// sign-in (when configured), and links to sign-up / forgot password.
class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _turnstileKey = GlobalKey<TurnstileFieldState>();
  String? _captchaToken;
  String? _error;
  bool _loading = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    final token = _captchaToken;
    if (_loading || token == null) return;
    setState(() {
      _error = null;
      _loading = true;
    });
    final error = await ref.read(authControllerProvider.notifier).signInWithEmail(
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
      // The token was consumed by this attempt; get a fresh one for the retry.
      setState(() => _captchaToken = null);
      await _turnstileKey.currentState?.reset();
    }
    // On success the router redirects off the auth state change.
  }

  Future<void> _signInWithGoogle() async {
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
    final cycle = ref.watch(cycleProvider);
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'Chevras Mishnayos Baal Peh',
                    style: theme.textTheme.headlineMedium,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Complete the entire Mishna together by Rosh Chodesh '
                    'Sivan — one mishna at a time.',
                    style: theme.textTheme.bodyLarge,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 16),
                  if (cycle.value case final c?) ...[
                    CycleProgressBar(cycle: c),
                    const SizedBox(height: 16),
                  ],
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
                    autofillHints: const [AutofillHints.password],
                    decoration: const InputDecoration(labelText: 'Password'),
                    onSubmitted: (_) => _signIn(),
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
                    onPressed:
                        _captchaToken == null || _loading ? null : _signIn,
                    child: _loading
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Log in'),
                  ),
                  TextButton(
                    onPressed: () => context.push('/forgot-password'),
                    child: const Text('Forgot your password?'),
                  ),
                  if (AppConfig.googleSignInEnabled) ...[
                    const Divider(height: 32),
                    OutlinedButton.icon(
                      onPressed: _loading ? null : _signInWithGoogle,
                      icon: const Icon(Icons.login),
                      label: const Text('Sign in with Google'),
                    ),
                  ],
                  const SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Text('New to the program?'),
                      TextButton(
                        onPressed: () => context.push('/sign-up'),
                        child: const Text('Join here'),
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
