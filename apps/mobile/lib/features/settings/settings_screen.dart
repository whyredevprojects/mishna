import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:timezone/timezone.dart' as tz;

import '../../data/models.dart';
import '../../data/repositories.dart';
import '../auth/auth_controller.dart';
import '../notifications/notification_settings.dart';

const _dayNames = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/// Account info, the server-side email preferences, the on-device reminder
/// settings, and the leave-cycle / sign-out actions.
class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  EmailPrefs? _prefs;
  bool _saving = false;
  bool _leaving = false;

  /// All IANA zones from the bundled tz database (initialized at app start),
  /// with the server value guaranteed present.
  late final List<String> _zones = () {
    final zones = tz.timeZoneDatabase.locations.keys.toList()..sort();
    return zones;
  }();

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authControllerProvider).value;
    final prefsAsync = ref.watch(preferencesProvider);
    // Seed the editable copy once the server prefs arrive; later refetches
    // don't clobber in-progress edits.
    if (_prefs == null && prefsAsync.value != null) {
      _prefs = prefsAsync.value;
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (me != null) _accountCard(me),
          const SizedBox(height: 12),
          _emailPrefsCard(prefsAsync),
          const SizedBox(height: 12),
          _remindersCard(),
          const SizedBox(height: 12),
          _actionsCard(me),
        ],
      ),
    );
  }

  // -- account ----------------------------------------------------------------

  Widget _accountCard(Me me) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Account', style: theme.textTheme.titleMedium),
            const SizedBox(height: 12),
            _infoRow('Name', me.user.name ?? '—'),
            _infoRow('Email', me.user.email ?? '—'),
            _infoRow('Role', me.user.role ?? 'user'),
            if (me.joined)
              _infoRow('Weekly goal', '${me.commitment} mishnayos / week'),
          ],
        ),
      ),
    );
  }

  Widget _infoRow(String label, String value) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(
              label,
              style: theme.textTheme.bodyMedium!
                  .copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
          Expanded(child: Text(value, style: theme.textTheme.bodyMedium)),
        ],
      ),
    );
  }

  // -- email preferences --------------------------------------------------------

  Widget _emailPrefsCard(AsyncValue<EmailPrefs> prefsAsync) {
    final theme = Theme.of(context);
    final prefs = _prefs;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Email preferences', style: theme.textTheme.titleMedium),
            const SizedBox(height: 12),
            if (prefs == null)
              prefsAsync.hasError
                  ? const Text('Could not load your preferences.')
                  : const Center(child: CircularProgressIndicator())
            else ...[
              Row(
                children: [
                  Expanded(
                    child: DropdownMenu<String>(
                      label: const Text('Timezone'),
                      initialSelection: prefs.timezone,
                      expandedInsets: EdgeInsets.zero,
                      menuHeight: 400,
                      enableFilter: true,
                      requestFocusOnTap: true,
                      dropdownMenuEntries: [
                        for (final z in _withCurrent(prefs.timezone))
                          DropdownMenuEntry(value: z, label: z),
                      ],
                      onSelected: (z) {
                        if (z != null) {
                          setState(
                            () => _prefs = prefs.copyWith(timezone: z),
                          );
                        }
                      },
                    ),
                  ),
                  IconButton(
                    tooltip: 'Detect timezone',
                    icon: const Icon(Icons.my_location),
                    onPressed: () async {
                      final detected =
                          await FlutterTimezone.getLocalTimezone();
                      if (!mounted) return;
                      if (_zones.contains(detected.identifier)) {
                        setState(
                          () => _prefs =
                              prefs.copyWith(timezone: detected.identifier),
                        );
                      }
                    },
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                'Emails are sent at 8:00 AM in this timezone.',
                style: theme.textTheme.bodySmall,
              ),
              const SizedBox(height: 16),
              _dowDropdown(
                label: 'Weekly email day',
                hint: "The day you receive that week's mishnayos.",
                value: prefs.weeklyEmailDow,
                onChanged: (d) =>
                    setState(() => _prefs = prefs.copyWith(weeklyEmailDow: d)),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Send me the weekly mishnayos email'),
                value: prefs.weeklyEnabled,
                onChanged: (v) =>
                    setState(() => _prefs = prefs.copyWith(weeklyEnabled: v)),
              ),
              const Divider(),
              _dowDropdown(
                label: 'Reminder email day',
                hint: "A nudge if you haven't finished that week's "
                    'mishnayos yet.',
                value: prefs.reminderEmailDow,
                onChanged: (d) => setState(
                  () => _prefs = prefs.copyWith(reminderEmailDow: d),
                ),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Send me the weekly reminder email'),
                value: prefs.reminderEnabled,
                onChanged: (v) =>
                    setState(() => _prefs = prefs.copyWith(reminderEnabled: v)),
              ),
              const SizedBox(height: 8),
              FilledButton(
                onPressed: _saving ? null : _savePrefs,
                child: _saving
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Save preferences'),
              ),
            ],
          ],
        ),
      ),
    );
  }

  List<String> _withCurrent(String current) =>
      _zones.contains(current) ? _zones : [current, ..._zones];

  Widget _dowDropdown({
    required String label,
    required String hint,
    required int value,
    required ValueChanged<int> onChanged,
  }) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        DropdownMenu<int>(
          label: Text(label),
          initialSelection: value,
          expandedInsets: EdgeInsets.zero,
          dropdownMenuEntries: [
            for (var d = 0; d < 7; d++)
              DropdownMenuEntry(value: d, label: _dayNames[d]),
          ],
          onSelected: (d) {
            if (d != null) onChanged(d);
          },
        ),
        const SizedBox(height: 4),
        Text(hint, style: theme.textTheme.bodySmall),
      ],
    );
  }

  Future<void> _savePrefs() async {
    final prefs = _prefs;
    if (prefs == null) return;
    setState(() => _saving = true);
    try {
      await ref.read(apiRepositoryProvider).updatePreferences(prefs);
      ref.invalidate(preferencesProvider);
      _toast('Preferences saved.');
    } catch (_) {
      _toast('Could not save your preferences.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  // -- on-device reminders -------------------------------------------------------

  Widget _remindersCard() {
    final theme = Theme.of(context);
    final settingsAsync = ref.watch(notificationSettingsProvider);
    final settings = settingsAsync.value;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('App reminders', style: theme.textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(
              'Notifications from this device — separate from the emails.',
              style: theme.textTheme.bodySmall,
            ),
            if (settings == null)
              const Padding(
                padding: EdgeInsets.all(16),
                child: Center(child: CircularProgressIndicator()),
              )
            else ...[
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Daily reminder to memorize'),
                subtitle: Text(
                  'Every day at '
                  '${_formatTime(settings.memorizeHour, settings.memorizeMinute)}',
                ),
                value: settings.memorizeEnabled,
                onChanged: (v) => _updateReminders(
                  settings.copyWith(memorizeEnabled: v),
                ),
              ),
              if (settings.memorizeEnabled)
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    icon: const Icon(Icons.schedule, size: 18),
                    label: const Text('Change time'),
                    onPressed: () async {
                      final picked = await showTimePicker(
                        context: context,
                        initialTime: TimeOfDay(
                          hour: settings.memorizeHour,
                          minute: settings.memorizeMinute,
                        ),
                      );
                      if (picked != null) {
                        await _updateReminders(
                          settings.copyWith(
                            memorizeHour: picked.hour,
                            memorizeMinute: picked.minute,
                          ),
                        );
                      }
                    },
                  ),
                ),
              const Divider(),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Weekly reminder to review'),
                subtitle: Text(
                  '${_dayNames[settings.reviewDow]}s at '
                  '${_formatTime(settings.reviewHour, settings.reviewMinute)}',
                ),
                value: settings.reviewEnabled,
                onChanged: (v) => _updateReminders(
                  settings.copyWith(reviewEnabled: v),
                ),
              ),
              if (settings.reviewEnabled)
                Row(
                  children: [
                    TextButton.icon(
                      icon: const Icon(Icons.schedule, size: 18),
                      label: const Text('Change time'),
                      onPressed: () async {
                        final picked = await showTimePicker(
                          context: context,
                          initialTime: TimeOfDay(
                            hour: settings.reviewHour,
                            minute: settings.reviewMinute,
                          ),
                        );
                        if (picked != null) {
                          await _updateReminders(
                            settings.copyWith(
                              reviewHour: picked.hour,
                              reviewMinute: picked.minute,
                            ),
                          );
                        }
                      },
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: DropdownMenu<int>(
                        label: const Text('Day'),
                        initialSelection: settings.reviewDow,
                        expandedInsets: EdgeInsets.zero,
                        dropdownMenuEntries: [
                          for (var d = 0; d < 7; d++)
                            DropdownMenuEntry(value: d, label: _dayNames[d]),
                        ],
                        onSelected: (d) {
                          if (d != null) {
                            _updateReminders(settings.copyWith(reviewDow: d));
                          }
                        },
                      ),
                    ),
                  ],
                ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _updateReminders(NotificationSettings settings) async {
    await ref.read(notificationSettingsProvider.notifier).applySettings(settings);
    final applied = ref.read(notificationSettingsProvider).value;
    // The controller refuses an enable when the OS denies permission.
    if (applied != null &&
        settings.memorizeEnabled != applied.memorizeEnabled) {
      _toast('Notifications are disabled for this app in system settings.');
    }
  }

  String _formatTime(int hour, int minute) {
    final time = TimeOfDay(hour: hour, minute: minute);
    return time.format(context);
  }

  // -- actions -------------------------------------------------------------------

  Widget _actionsCard(Me? me) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            OutlinedButton.icon(
              icon: const Icon(Icons.logout),
              label: const Text('Log out'),
              onPressed: () =>
                  ref.read(authControllerProvider.notifier).signOut(),
            ),
            if (me?.joined == true) ...[
              const SizedBox(height: 12),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: theme.colorScheme.error,
                ),
                icon: const Icon(Icons.person_remove_outlined),
                label: _leaving
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Leave the cycle'),
                onPressed: _leaving ? null : _confirmLeave,
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _confirmLeave() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Leave the cycle?'),
        content: const Text(
          'Your lots are released back to your group so someone else can '
          'pick them up. Your memorization history is kept.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Leave'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    setState(() => _leaving = true);
    try {
      await ref.read(apiRepositoryProvider).leave();
      ref.invalidate(assignmentProvider);
      ref.invalidate(chalukaProvider);
      await ref.read(authControllerProvider.notifier).refresh();
      _toast('You have left the cycle.');
    } catch (_) {
      _toast('Could not leave the cycle. Please try again.');
    } finally {
      if (mounted) setState(() => _leaving = false);
    }
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }
}
