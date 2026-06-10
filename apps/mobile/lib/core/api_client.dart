import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'config.dart';

/// The persistent cookie jar holding the better-auth session cookie. Created in
/// `main()` (it needs a documents directory) and injected via a ProviderScope
/// override; reading the un-overridden provider is a programmer error.
final cookieJarProvider = Provider<PersistCookieJar>(
  (ref) => throw UnimplementedError('overridden in main()'),
);

/// One Dio for the whole app: base URL, session cookies, and an Origin header
/// on state-changing requests (better-auth's CSRF check rejects POSTs whose
/// Origin is missing or untrusted; a native client has none by default, so we
/// send the API's own origin, which is in the login worker's trustedOrigins).
final dioProvider = Provider<Dio>((ref) {
  final dio = Dio(
    BaseOptions(
      baseUrl: AppConfig.apiBaseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 20),
      headers: {'accept': 'application/json'},
    ),
  );
  dio.interceptors.add(CookieManager(ref.watch(cookieJarProvider)));
  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, handler) {
        if (options.method != 'GET') {
          options.headers['origin'] = AppConfig.apiBaseUrl;
        }
        handler.next(options);
      },
    ),
  );
  return dio;
});
