import 'package:cookie_jar/cookie_jar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import 'app.dart';
import 'core/api_client.dart';
import 'features/notifications/notification_settings.dart';
import 'features/notifications/notification_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Session cookies persist across launches, so sign-in survives restarts.
  final docs = await getApplicationDocumentsDirectory();
  final cookieJar = PersistCookieJar(
    storage: FileStorage('${docs.path}/.cookies/'),
  );

  // Re-apply the saved reminder schedules on every launch — robust against
  // reboots, app updates, and timezone changes.
  final notifications = NotificationService();
  await notifications.init();
  final reminderSettings = await NotificationSettings.load();
  await notifications.applySchedule(reminderSettings);

  runApp(
    ProviderScope(
      overrides: [
        cookieJarProvider.overrideWithValue(cookieJar),
        notificationServiceProvider.overrideWithValue(notifications),
      ],
      child: const ChevrasMishnayosApp(),
    ),
  );
}
