import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'notification_service.dart';

/// On-device reminder settings (independent of the server's email
/// preferences): a daily "memorize" nudge and a weekly "review" nudge, each
/// with its own time. Persisted locally; schedules are re-applied on every
/// app launch and whenever they change, so they survive reboots and edits.
class NotificationSettings {
  const NotificationSettings({
    required this.memorizeEnabled,
    required this.memorizeHour,
    required this.memorizeMinute,
    required this.reviewEnabled,
    required this.reviewDow,
    required this.reviewHour,
    required this.reviewMinute,
  });

  /// Daily reminder to learn/memorize today's mishnayos.
  final bool memorizeEnabled;
  final int memorizeHour;
  final int memorizeMinute;

  /// Weekly reminder to review what you've learned so far.
  final bool reviewEnabled;

  /// 0=Sunday … 6=Saturday (same convention as the server's email prefs).
  final int reviewDow;
  final int reviewHour;
  final int reviewMinute;

  static const defaults = NotificationSettings(
    memorizeEnabled: false,
    memorizeHour: 19,
    memorizeMinute: 0,
    reviewEnabled: false,
    reviewDow: 5, // Friday — review before Shabbos.
    reviewHour: 10,
    reviewMinute: 0,
  );

  NotificationSettings copyWith({
    bool? memorizeEnabled,
    int? memorizeHour,
    int? memorizeMinute,
    bool? reviewEnabled,
    int? reviewDow,
    int? reviewHour,
    int? reviewMinute,
  }) =>
      NotificationSettings(
        memorizeEnabled: memorizeEnabled ?? this.memorizeEnabled,
        memorizeHour: memorizeHour ?? this.memorizeHour,
        memorizeMinute: memorizeMinute ?? this.memorizeMinute,
        reviewEnabled: reviewEnabled ?? this.reviewEnabled,
        reviewDow: reviewDow ?? this.reviewDow,
        reviewHour: reviewHour ?? this.reviewHour,
        reviewMinute: reviewMinute ?? this.reviewMinute,
      );

  Map<String, dynamic> toJson() => {
        'memorizeEnabled': memorizeEnabled,
        'memorizeHour': memorizeHour,
        'memorizeMinute': memorizeMinute,
        'reviewEnabled': reviewEnabled,
        'reviewDow': reviewDow,
        'reviewHour': reviewHour,
        'reviewMinute': reviewMinute,
      };

  factory NotificationSettings.fromJson(Map<String, dynamic> json) =>
      NotificationSettings(
        memorizeEnabled: json['memorizeEnabled'] == true,
        memorizeHour: json['memorizeHour'] as int? ?? defaults.memorizeHour,
        memorizeMinute:
            json['memorizeMinute'] as int? ?? defaults.memorizeMinute,
        reviewEnabled: json['reviewEnabled'] == true,
        reviewDow: json['reviewDow'] as int? ?? defaults.reviewDow,
        reviewHour: json['reviewHour'] as int? ?? defaults.reviewHour,
        reviewMinute: json['reviewMinute'] as int? ?? defaults.reviewMinute,
      );

  static const _prefsKey = 'notification-settings';

  static Future<NotificationSettings> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_prefsKey);
    if (raw == null) return defaults;
    try {
      return NotificationSettings.fromJson(
        jsonDecode(raw) as Map<String, dynamic>,
      );
    } catch (_) {
      return defaults;
    }
  }

  Future<void> save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefsKey, jsonEncode(toJson()));
  }
}

/// Settings + scheduling kept in lockstep: every update persists and
/// re-applies the device schedules.
class NotificationSettingsController
    extends AsyncNotifier<NotificationSettings> {
  @override
  Future<NotificationSettings> build() => NotificationSettings.load();

  Future<void> applySettings(NotificationSettings settings) async {
    // Enabling a reminder is the moment to ask for permission; refuse the
    // toggle (keep it off) if the OS says no, so the UI never lies.
    final service = ref.read(notificationServiceProvider);
    var effective = settings;
    final wasEnabled = state.value ?? NotificationSettings.defaults;
    final turningOn = (settings.memorizeEnabled && !wasEnabled.memorizeEnabled) ||
        (settings.reviewEnabled && !wasEnabled.reviewEnabled);
    if (turningOn) {
      final granted = await service.requestPermissions();
      if (!granted) {
        effective = settings.copyWith(
          memorizeEnabled:
              wasEnabled.memorizeEnabled && settings.memorizeEnabled,
          reviewEnabled: wasEnabled.reviewEnabled && settings.reviewEnabled,
        );
      }
    }
    await effective.save();
    await service.applySchedule(effective);
    state = AsyncData(effective);
  }
}

final notificationSettingsProvider =
    AsyncNotifierProvider<NotificationSettingsController, NotificationSettings>(
  NotificationSettingsController.new,
);
