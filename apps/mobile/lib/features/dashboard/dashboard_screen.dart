import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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

  Future<void> _join(int commitment) async {
    setState(() => _joining = true);
    try {
      await ref.read(apiRepositoryProvider).join(commitment);
      // Membership changed → re-derive session + assignment from the server.
      ref.invalidate(todayAssignmentProvider);
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
    ref.invalidate(todayAssignmentProvider);
    await ref.read(authControllerProvider.notifier).refresh();
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authControllerProvider).value;
    final joined = me?.joined ?? false;
    final cycle = ref.watch(cycleProvider);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Chevras Mishnayos')),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (!joined) ...[
              JoinForm(onJoin: _join, loading: _joining),
            ] else ...[
              Text("This week's mishnayos", style: theme.textTheme.bodyMedium),
              const SizedBox(height: 8),
              ..._assignmentSection(),
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

  List<Widget> _assignmentSection() {
    final theme = Theme.of(context);
    final assignment = ref.watch(todayAssignmentProvider);
    final Assignment? a = assignment.value;
    if (a != null) {
      seedCompletions(a, a.completed);
    }
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
