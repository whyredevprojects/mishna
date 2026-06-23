import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models.dart';
import '../../data/repositories.dart';
import '../../widgets/completion_sync.dart';
import '../../widgets/cycle_progress_bar.dart';
import '../../widgets/join_form.dart';
import '../../widgets/mishna_card.dart';
import '../auth/auth_controller.dart';

/// Logged-in home: the user's current mishnayot (a prev/next bucket pager) when
/// joined, otherwise the join card; cycle progress underneath either way.
class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen>
    with CompletionSync {
  bool _joining = false;

  /// The pager position: `null` is the current (next-unlearned) bucket, an `int`
  /// is an explicit bucket. prev/next set an index relative to whatever the
  /// server reports it served.
  int? _bucket;

  /// Last assignment we had data for — kept on screen while stepping to a not-
  /// yet-cached bucket, so navigation doesn't flash a spinner (the web client's
  /// `keepPreviousData`).
  Assignment? _shown;

  Future<void> _join(int commitment) async {
    setState(() => _joining = true);
    try {
      await ref.read(apiRepositoryProvider).join(commitment);
      // Membership changed → re-derive session + assignment from the server.
      ref.invalidate(assignmentProvider);
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
    ref.invalidate(assignmentProvider);
    await ref.read(authControllerProvider.notifier).refresh();
  }

  /// The bucket the server actually served (after clamping), and the bounds it
  /// reports — so prev/next always step from the real position.
  int get _served => _shown?.bucket ?? 0;
  int get _bucketCount => _shown?.bucketCount ?? 0;
  int get _currentBucket => _shown?.currentBucket ?? 0;

  bool get _canPrev => _served > 0;

  /// The last bucket is the end of the road forward.
  bool get _canNext => _served < _bucketCount - 1;

  void _prev() {
    if (_canPrev) setState(() => _bucket = _served - 1);
  }

  void _next() {
    if (_canNext) setState(() => _bucket = _served + 1);
  }

  void _onSwipe(DragEndDetails details) {
    final velocity = details.primaryVelocity ?? 0;
    if (velocity < -200) {
      _next(); // swipe left → forward a bucket
    } else if (velocity > 200) {
      _prev(); // swipe right → back a bucket
    }
  }

  /// Where the shown bucket sits relative to the current (next-unlearned) one.
  String get _pagerLabel {
    if (_served < _currentBucket) return 'Already learned';
    if (_served > _currentBucket) return 'Coming up';
    return 'Current mishnayos';
  }

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
              _pagerNav(theme),
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

  /// Prev/next bucket stepper, label showing where the shown bucket sits
  /// relative to the current (next-unlearned) one.
  Widget _pagerNav(ThemeData theme) {
    return Row(
      children: [
        IconButton(
          icon: const Icon(Icons.chevron_left),
          tooltip: 'Previous mishnayos',
          onPressed: _canPrev ? _prev : null,
        ),
        Expanded(
          child: Text(
            _pagerLabel,
            textAlign: TextAlign.center,
            style: theme.textTheme.titleSmall,
          ),
        ),
        IconButton(
          icon: const Icon(Icons.chevron_right),
          tooltip: 'Next mishnayos',
          onPressed: _canNext ? _next : null,
        ),
      ],
    );
  }

  List<Widget> _assignmentSection() {
    final theme = Theme.of(context);
    final assignment = ref.watch(assignmentProvider(_bucket));
    final fresh = assignment.value;
    if (fresh != null) {
      _shown = fresh;
      seedCompletions(fresh, fresh.completed);
    }
    // While stepping to a not-yet-loaded bucket, keep the last one on screen.
    final Assignment? a = _shown;
    if (a == null) {
      if (assignment.hasError) {
        return [
          Card(
            color: theme.colorScheme.errorContainer,
            child: const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Could not load your mishnayos.'),
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
      // An empty bucket means the whole portion is learned (the finished state).
      return [
        Row(
          children: [
            Icon(Icons.check_circle, color: theme.colorScheme.primary),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                "You've finished all your mishnayos!",
                style: theme.textTheme.titleSmall!
                    .copyWith(color: theme.colorScheme.primary),
              ),
            ),
          ],
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
