import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

import 'notification_settings.dart';

/// Local (on-device) reminders, scheduled with the platform's notification
/// services via flutter_local_notifications. Recurrence uses calendar
/// matching (daily at a time / weekly at a weekday+time) in the device's
/// timezone, with inexact Android scheduling — no exact-alarm permission
/// needed, and minute-level drift is fine for a study nudge.
class NotificationService {
  static const _memorizeId = 1;
  static const _reviewId = 2;

  static const _channel = AndroidNotificationDetails(
    'reminders',
    'Study reminders',
    channelDescription: 'Daily memorize and weekly review reminders',
    importance: Importance.defaultImportance,
    priority: Priority.defaultPriority,
  );

  final _plugin = FlutterLocalNotificationsPlugin();
  bool _initialized = false;

  /// Invoked with a notification's payload (an app route, e.g. `/review`)
  /// when the user taps it. Assigned by the router once it exists.
  void Function(String payload)? onSelectPayload;

  /// Initialize the plugin + timezone database. Safe to call repeatedly.
  Future<void> init() async {
    if (_initialized) return;
    _initialized = true;

    tzdata.initializeTimeZones();
    try {
      final localTz = await FlutterTimezone.getLocalTimezone();
      tz.setLocalLocation(tz.getLocation(localTz.identifier));
    } catch (_) {
      // Keep the package default (UTC) if the device zone can't be resolved;
      // reminders still fire, just anchored to UTC.
    }

    await _plugin.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(
          // Permission is requested when the user enables a reminder, not at
          // first launch.
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
        ),
      ),
      onDidReceiveNotificationResponse: (response) {
        final payload = response.payload;
        if (payload != null && payload.isNotEmpty) {
          onSelectPayload?.call(payload);
        }
      },
    );
  }

  /// Ask the OS for notification permission. Returns whether it's granted
  /// (best-effort true when the platform doesn't say).
  Future<bool> requestPermissions() async {
    await init();
    if (defaultTargetPlatform == TargetPlatform.android) {
      final android = _plugin.resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin>();
      final granted = await android?.requestNotificationsPermission();
      return granted ?? true;
    }
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      final ios = _plugin.resolvePlatformSpecificImplementation<
          IOSFlutterLocalNotificationsPlugin>();
      final granted =
          await ios?.requestPermissions(alert: true, badge: true, sound: true);
      return granted ?? true;
    }
    return true;
  }

  /// Cancel-and-reschedule everything from [settings]. Called on app start
  /// (so schedules survive reboots/reinstalls) and on every settings change.
  Future<void> applySchedule(NotificationSettings settings) async {
    await init();
    await _plugin.cancelAll();

    if (settings.memorizeEnabled) {
      await _plugin.zonedSchedule(
        id: _memorizeId,
        title: 'Time to learn your mishnayos',
        body: "A few minutes a day keeps this week's mishnayos baal peh.",
        scheduledDate:
            _nextInstance(settings.memorizeHour, settings.memorizeMinute),
        notificationDetails: const NotificationDetails(android: _channel),
        androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
        matchDateTimeComponents: DateTimeComponents.time,
        payload: '/dashboard',
      );
    }

    if (settings.reviewEnabled) {
      await _plugin.zonedSchedule(
        id: _reviewId,
        title: 'Review time',
        body: 'Look back over the mishnayos you already know.',
        scheduledDate: _nextWeeklyInstance(
          settings.reviewDow,
          settings.reviewHour,
          settings.reviewMinute,
        ),
        notificationDetails: const NotificationDetails(android: _channel),
        androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
        matchDateTimeComponents: DateTimeComponents.dayOfWeekAndTime,
        payload: '/review',
      );
    }
  }

  /// The next occurrence of `hour:minute` in the device's timezone.
  tz.TZDateTime _nextInstance(int hour, int minute) {
    final now = tz.TZDateTime.now(tz.local);
    var scheduled =
        tz.TZDateTime(tz.local, now.year, now.month, now.day, hour, minute);
    if (!scheduled.isAfter(now)) {
      scheduled = scheduled.add(const Duration(days: 1));
    }
    return scheduled;
  }

  /// The next occurrence of `dow hour:minute` (dow 0=Sunday … 6=Saturday).
  tz.TZDateTime _nextWeeklyInstance(int dow, int hour, int minute) {
    var scheduled = _nextInstance(hour, minute);
    // DateTime.weekday is 1=Monday … 7=Sunday; convert ours (0=Sunday).
    final targetWeekday = dow == 0 ? DateTime.sunday : dow;
    while (scheduled.weekday != targetWeekday) {
      scheduled = scheduled.add(const Duration(days: 1));
    }
    return scheduled;
  }
}

final notificationServiceProvider =
    Provider<NotificationService>((ref) => NotificationService());
