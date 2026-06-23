import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_client.dart';
import 'models.dart';

/// Auth calls against the better-auth login worker (`/api/auth/*`). The
/// session cookie is owned by the Dio cookie jar; a successful sign-in leaves
/// it set, and `/api/me` is how session state is confirmed.
class AuthRepository {
  AuthRepository(this._dio);

  final Dio _dio;

  /// The session + join state, or null when unauthenticated (401).
  Future<Me?> me() async {
    try {
      final res = await _dio.get<Map<String, dynamic>>('/api/me');
      return Me.fromJson(res.data!);
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) return null;
      rethrow;
    }
  }

  /// `captchaToken` is the Cloudflare Turnstile token the login worker's
  /// captcha plugin validates on sign-in/sign-up/reset (header
  /// `x-captcha-response`).
  Future<void> signInWithEmail(
    String email,
    String password, {
    String? captchaToken,
  }) {
    return _dio.post(
      '/api/auth/sign-in/email',
      data: {'email': email, 'password': password},
      options: _captcha(captchaToken),
    );
  }

  Future<void> signUpWithEmail(
    String name,
    String email,
    String password, {
    String? captchaToken,
  }) {
    return _dio.post(
      '/api/auth/sign-up/email',
      data: {'name': name, 'email': email, 'password': password},
      options: _captcha(captchaToken),
    );
  }

  /// Native Google sign-in: google_sign_in mints an ID token whose audience is
  /// the better-auth web client id, and better-auth's `sign-in/social` accepts
  /// it directly (no browser redirect), setting the session cookie.
  Future<void> signInWithGoogleIdToken(String idToken) {
    return _dio.post(
      '/api/auth/sign-in/social',
      data: {
        'provider': 'google',
        'idToken': {'token': idToken},
      },
    );
  }

  /// Emails a password-reset link. The link lands on the website's
  /// /reset-password page, so the flow completes in the browser. Resolves
  /// whether or not the address exists (no enumeration).
  Future<void> requestPasswordReset(String email, {String? captchaToken}) {
    return _dio.post(
      '/api/auth/request-password-reset',
      data: {'email': email, 'redirectTo': '/reset-password'},
      options: _captcha(captchaToken),
    );
  }

  Future<void> signOut() => _dio.post('/api/auth/sign-out', data: {});

  Options? _captcha(String? token) => token == null
      ? null
      : Options(headers: {'x-captcha-response': token});
}

/// The main REST API (apps/server): cycle, assignments, chaluka, completions,
/// join/leave, and email preferences.
class MishnaApiRepository {
  MishnaApiRepository(this._dio);

  final Dio _dio;

  Future<Cycle> cycle() async {
    final res = await _dio.get<Map<String, dynamic>>('/api/cycle');
    return Cycle.fromJson(res.data!);
  }

  Future<List<JoinOption>> joinOptions() async {
    final res = await _dio.get<Map<String, dynamic>>('/api/join-options');
    final options = (res.data!['options'] as List<dynamic>)
        .map((o) => JoinOption.fromJson(o as Map<String, dynamic>))
        .toList();
    return options;
  }

  /// The caller's assignment for an explicit `YYYY-MM-DD` week-start (UTC); the
  /// server derives the week containing that date.
  Future<Assignment> assignmentForDate(String date) async {
    final res = await _dio.get<Map<String, dynamic>>(
      '/api/assignments',
      queryParameters: {'date': date},
    );
    return Assignment.fromJson(res.data!);
  }

  Future<Chaluka> chaluka() async {
    final res = await _dio.get<Map<String, dynamic>>('/api/me/chaluka');
    return Chaluka.fromJson(res.data!);
  }

  Future<EmailPrefs> preferences() async {
    final res = await _dio.get<Map<String, dynamic>>('/api/me/preferences');
    return EmailPrefs.fromJson(res.data!);
  }

  Future<void> updatePreferences(EmailPrefs prefs) =>
      _dio.put('/api/me/preferences', data: prefs.toJson());

  Future<void> join(int commitment) =>
      _dio.post('/api/join', data: {'commitment': commitment});

  Future<void> leave() => _dio.post('/api/leave', data: {});

  /// Mark a mishna learned, attributed to `groupId` (handed down with the
  /// assignment/chaluka — the server validates membership).
  Future<void> markLearned(MishnaRef ref, String groupId) => _dio.post(
        '/api/completions',
        data: {'ref': ref.toJson(), 'groupId': groupId},
      );

  Future<void> markUnlearned(MishnaRef ref, String groupId) => _dio.delete(
        '/api/completions',
        data: {'ref': ref.toJson(), 'groupId': groupId},
      );
}

final authRepositoryProvider =
    Provider<AuthRepository>((ref) => AuthRepository(ref.watch(dioProvider)));

final apiRepositoryProvider = Provider<MishnaApiRepository>(
  (ref) => MishnaApiRepository(ref.watch(dioProvider)),
);

// -- read providers (the TanStack-Query analog: cached until invalidated) ----

final cycleProvider = FutureProvider<Cycle>(
  (ref) => ref.watch(apiRepositoryProvider).cycle(),
);

final joinOptionsProvider = FutureProvider<List<JoinOption>>(
  (ref) => ref.watch(apiRepositoryProvider).joinOptions(),
);

/// One assignment per week-start date (`YYYY-MM-DD`, UTC) — each week caches
/// separately, so the dashboard's week pager can step without refetching weeks
/// it already loaded. Invalidate the whole family to refresh every cached week.
final assignmentByDateProvider = FutureProvider.family<Assignment, String>(
  (ref, date) => ref.watch(apiRepositoryProvider).assignmentForDate(date),
);

final chalukaProvider = FutureProvider<Chaluka>(
  (ref) => ref.watch(apiRepositoryProvider).chaluka(),
);

final preferencesProvider = FutureProvider<EmailPrefs>(
  (ref) => ref.watch(apiRepositoryProvider).preferences(),
);
