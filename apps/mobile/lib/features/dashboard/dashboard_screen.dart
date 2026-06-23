import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/formatting.dart';
import '../../data/models.dart';
import '../../data/repositories.dart';
import '../../widgets/completion_sync.dart';
import '../../widgets/cycle_progress_bar.dart';
import '../../widgets/join_form.dart';
import '../../widgets/mishna_card.dart';
import '../auth/auth_controller.dart';

/// Logged-in home: this week's mishnayot when joined, otherwise the join card;
/// cycle progress underneath either way.
class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen>
    with CompletionSync {
  bool _joining = false;

  /// The week-start (Sunday, UTC) the user is currently viewing, and today's —
  /// the pager steps `_selectedWeek` while `_currentWeek` labels "This week".
  final String _currentWeek = sundayOnOrBefore(DateTime.now());
  late String _selectedWeek = _currentWeek;

  /// Last assignment we had data for — kept on screen while stepping to a not-
  /// yet-cached week, so navigation doesn't flash a spinner (the web client's
  /// `keepPreviousData`).
  Assignment? _shown;

  Future<void> _join(int commitment) async {
    setState(() => _joining = true);
    try {
      await ref.read(apiRepositoryProvider).join(commitment);
      // Membership changed → re-derive session + assignment from the server.
      ref.invalidate(assignmentByDateProvider);
      ref.invalidate(chalukaProvider);
      await ref.read(authControllerProvider.notifier).refresh();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not join the cycle. Please try again.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _joining = false);
    }
  }

  Future<void> _refresh() async {
    ref.invalidate(cycleProvider);
    ref.invalidate(joinOptionsProvider);
    ref.invalidate(assignmentByDateProvider);
    await ref.read(authControllerProvider.notifier).refresh();
  }

  /// The cycle's first week (Sunday on/before its start), once the cycle loads.
  String? _cycleStartWeek() {
    final cycle = ref.read(cycleProvider).value;
    return cycle == null
        ? null
        : sundayOnOrBefore(DateTime.parse(cycle.cycleStart));
  }

  /// Before the cycle's first week is off-limits.
  bool get _canPrev {
    final start = _cycleStartWeek();
    return start == null || _selectedWeek.compareTo(start) > 0;
  }

  /// A user's portion empties contiguously once finished, so an empty displayed
  /// week is the end of the road forward.
  bool get _canNext => _shown?.mishnas.isNotEmpty ?? false;

  void _prev() {
    if (_canPrev) setState(() => _selectedWeek = addWeeks(_selectedWeek, -1));
  }

  void _next() {
    if (_canNext) setState(() => _selectedWeek = addWeeks(_selectedWeek, 1));
  }

  void _onSwipe(DragEndDetails details) {
    final velocity = details.primaryVelocity ?? 0;
    if (velocity < -200) {
      _next(); // swipe left → forward a week
    } else if (velocity > 200) {
      _prev(); // swipe right → back a week
    }
  }

  String get _weekLabel => _selectedWeek == _currentWeek
      ? 'This week'
      : 'Week of ${formatMonthDayYear(_selectedWeek)}';

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authControllerProvider).value;
    final joined = me?.joined ?? false;
    final cycle = ref.watch(cycleProvider);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Chevras Mishnayos Baal Peh')),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (!joined) ...[
              ..._joinSection(),
            ] else ...[
              _weekNav(theme),
              const SizedBox(height: 8),
              GestureDetector(
                behavior: HitTestBehavior.opaque,
                onHorizontalDragEnd: _onSwipe,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: _assignmentSection(),
                ),
              ),
            ],
            if (cycle.value case final c?) ...[
              const Divider(height: 32),
              CycleProgressBar(cycle: c),
            ],
          ],
        ),
      ),
    );
  }

  List<Widget> _joinSection() {
    final theme = Theme.of(context);
    final options = ref.watch(joinOptionsProvider);
    return options.when(
      data: (opts) => [
        JoinForm(onJoin: _join, options: opts, loading: _joining),
      ],
      error: (_, _) => [
        Card(
          color: theme.colorScheme.errorContainer,
          child: const Padding(
            padding: EdgeInsets.all(16),
            child: Text('Could not load the join options. Pull to refresh.'),
          ),
        ),
      ],
      loading: () => [
        const Padding(
          padding: EdgeInsets.all(32),
          child: Center(child: CircularProgressIndicator()),
        ),
      ],
    );
  }

  /// Prev/next week stepper with a centered "This week" / "Week of …" label.
  Widget _weekNav(ThemeData theme) {
    return Row(
      children: [
        IconButton(
          icon: const Icon(Icons.chevron_left),
          tooltip: 'Previous week',
          onPressed: _canPrev ? _prev : null,
        ),
        Expanded(
          child: Text(
            _weekLabel,
            textAlign: TextAlign.center,
            style: theme.textTheme.titleSmall,
          ),
        ),
        IconButton(
          icon: const Icon(Icons.chevron_right),
          tooltip: 'Next week',
          onPressed: _canNext ? _next : null,
        ),
      ],
    );
  }

  List<Widget> _assignmentSection() {
    final theme = Theme.of(context);
    final assignment = ref.watch(assignmentByDateProvider(_selectedWeek));
    final fresh = assignment.value;
    if (fresh != null) {
      _shown = fresh;
      seedCompletions(fresh, fresh.completed);
    }
    // While stepping to a not-yet-loaded week, keep the last week on screen.
    final Assignment? a = _shown;
    if (a == null) {
      if (assignment.hasError) {
        return [
          Card(
            color: theme.colorScheme.errorContainer,
            child: const Padding(
              padding: EdgeInsets.all(16),
              child: Text("Could not load this week's assignment."),
            ),
          ),
        ];
      }
      return [
        const Padding(
          padding: EdgeInsets.all(32),
          child: Center(child: CircularProgressIndicator()),
        ),
      ];
    }
    if (a.mishnas.isEmpty) {
      return [
        Text(
          'No mishnayot assigned this week.',
          style: theme.textTheme.bodyMedium!
              .copyWith(color: theme.colorScheme.outline),
        ),
      ];
    }
    return [
      for (final mishnaRef in a.mishnas)
        MishnaCard(
          mishnaRef: mishnaRef,
          done: isLearned(mishnaRef),
          onToggleLearned: () => toggleCompletion(mishnaRef, a.groupId),
        ),
      if (a.mishnas.every(isLearned))
        Padding(
          padding: const EdgeInsets.only(top: 12),
          child: Row(
            children: [
              Icon(Icons.check_circle, color: theme.colorScheme.primary),
              const SizedBox(width: 8),
              Text(
                'Done for this week!',
                style: theme.textTheme.titleSmall!
                    .copyWith(color: theme.colorScheme.primary),
              ),
            ],
          ),
        ),
    ];
  }
}
