import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../../core/api_client.dart';
import '../../core/config.dart';
import '../../data/models.dart';
import '../../data/repositories.dart';

/// Session state: the latest GET /api/me, or null when signed out. The router
/// redirects off this; sign-in/out mutate it and clear the data providers so
/// the next user never sees the prior session's data.
class AuthController extends AsyncNotifier<Me?> {
  @override
  Future<Me?> build() => ref.read(authRepositoryProvider).me();

  /// Re-derives session + join state from the server (e.g. after /api/join).
  Future<void> refresh() async {
    state = AsyncData(await ref.read(authRepositoryProvider).me());
  }

  /// Signs in with email + password. Returns null on success, otherwise a
  /// user-facing error message.
  Future<String?> signInWithEmail(
    String email,
    String password, {
    String? captchaToken,
  }) {
    return _attempt(
      () => ref
          .read(authRepositoryProvider)
          .signInWithEmail(email, password, captchaToken: captchaToken),
      badRequestMessage: 'Incorrect email or password.',
    );
  }

  /// Creates an account (signed in immediately — better-auth doesn't require
  /// verification to sign in). Returns null on success, else an error message.
  Future<String?> signUpWithEmail(
    String name,
    String email,
    String password, {
    String? captchaToken,
  }) {
    return _attempt(
      () => ref
          .read(authRepositoryProvider)
          .signUpWithEmail(name, email, password, captchaToken: captchaToken),
      badRequestMessage: 'Could not create the account — the email may '
          'already be registered.',
    );
  }

  /// Native Google sign-in (only when GOOGLE_SERVER_CLIENT_ID is configured):
  /// gets an ID token from Google Play services, then exchanges it with
  /// better-auth. Returns null on success, an error message otherwise.
  Future<String?> signInWithGoogle() async {
    try {
      final signIn = GoogleSignIn.instance;
      await signIn.initialize(serverClientId: AppConfig.googleServerClientId);
      final account = await signIn.authenticate();
      final idToken = account.authentication.idToken;
      if (idToken == null) {
        return 'Google sign-in did not return a token.';
      }
      return await _attempt(
        () =>
            ref.read(authRepositoryProvider).signInWithGoogleIdToken(idToken),
        badRequestMessage: 'Google sign-in was rejected.',
      );
    } on GoogleSignInException catch (e) {
      // Canceled is a user action, not an error worth surfacing.
      if (e.code == GoogleSignInExceptionCode.canceled) return null;
      return 'Google sign-in failed. Please try again.';
    }
  }

  Future<void> signOut() async {
    try {
      await ref.read(authRepositoryProvider).signOut();
    } catch (_) {
      // Even if the server call fails, drop local session state.
    }
    await ref.read(cookieJarProvider).deleteAll();
    _clearDataProviders();
    state = const AsyncData(null);
  }

  /// Runs a sign-in/up call; on success refreshes the session and resets the
  /// cached reads (stale across users), on failure maps to a message.
  Future<String?> _attempt(
    Future<void> Function() call, {
    required String badRequestMessage,
  }) async {
    try {
      await call();
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status != null && status >= 400 && status < 500) {
        return badRequestMessage;
      }
      return 'Could not reach the server. Please try again.';
    }
    _clearDataProviders();
    await refresh();
    return null;
  }

  void _clearDataProviders() {
    ref.invalidate(assignmentByDateProvider);
    ref.invalidate(chalukaProvider);
    ref.invalidate(preferencesProvider);
  }
}

final authControllerProvider =
    AsyncNotifierProvider<AuthController, Me?>(AuthController.new);
