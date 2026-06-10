import 'package:chevras_mishnayos/features/notifications/notification_settings.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('defaults are returned when nothing is saved', () async {
    SharedPreferences.setMockInitialValues({});
    final settings = await NotificationSettings.load();
    expect(settings.memorizeEnabled, isFalse);
    expect(settings.reviewEnabled, isFalse);
    expect(settings.memorizeHour, 19);
  });

  test('save/load round-trips', () async {
    SharedPreferences.setMockInitialValues({});
    final settings = NotificationSettings.defaults.copyWith(
      memorizeEnabled: true,
      memorizeHour: 6,
      memorizeMinute: 30,
      reviewEnabled: true,
      reviewDow: 0,
    );
    await settings.save();
    final loaded = await NotificationSettings.load();
    expect(loaded.memorizeEnabled, isTrue);
    expect(loaded.memorizeHour, 6);
    expect(loaded.memorizeMinute, 30);
    expect(loaded.reviewEnabled, isTrue);
    expect(loaded.reviewDow, 0);
  });

  test('corrupt persisted JSON falls back to defaults', () async {
    SharedPreferences.setMockInitialValues({
      'notification-settings': 'not json',
    });
    final settings = await NotificationSettings.load();
    expect(settings.memorizeEnabled, isFalse);
  });
}
