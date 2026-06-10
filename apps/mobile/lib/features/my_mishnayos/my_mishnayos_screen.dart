import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/formatting.dart';
import '../../data/chaluka_view.dart';
import '../../data/models.dart';
import '../../data/repositories.dart';
import '../../widgets/completion_sync.dart';
import '../../widgets/mishna_card.dart';

/// "My Mishnayos": the user's whole-cycle portion. Two tabs — Assignments
/// (mishna-by-mishna list with learned checkboxes, grouped by mesechta) and
/// Stats (overall progress + per-mesechta breakdown).
class MyMishnayosScreen extends ConsumerStatefulWidget {
  const MyMishnayosScreen({super.key});

  @override
  ConsumerState<MyMishnayosScreen> createState() => _MyMishnayosScreenState();
}

class _MyMishnayosScreenState extends ConsumerState<MyMishnayosScreen>
    with CompletionSync {
  @override
  Widget build(BuildContext context) {
    final chaluka = ref.watch(chalukaProvider);
    if (chaluka.value case final data?) {
      seedCompletions(data, data.completed);
    }

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('My Mishnayos'),
          bottom: const TabBar(
            tabs: [Tab(text: 'Assignments'), Tab(text: 'Stats')],
          ),
        ),
        body: _body(chaluka),
      ),
    );
  }

  Widget _body(AsyncValue<Chaluka> chaluka) {
    final theme = Theme.of(context);
    final data = chaluka.value;
    if (data == null) {
      if (chaluka.hasError) {
        return const Center(child: Text('Could not load your assignments.'));
      }
      return const Center(child: CircularProgressIndicator());
    }
    if (data.assigned.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            "You haven't joined the cycle yet. Pick a commitment on the "
            'Today tab to get your chaluka.',
            style: theme.textTheme.bodyLarge,
            textAlign: TextAlign.center,
          ),
        ),
      );
    }
    return TabBarView(
      children: [_AssignmentsTab(data: data, state: this), _statsTab(data)],
    );
  }

  // -- Stats tab --------------------------------------------------------------

  Widget _statsTab(Chaluka data) {
    final theme = Theme.of(context);
    final total = data.assigned.length;
    // Live learned count: the optimistic local set, like the Assignments tab.
    final learned = data.assigned.where(isLearned).length;
    final pct = total > 0 ? (learned / total * 100).round() : 0;

    final breakdown = groupByMesechta(data);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Overall progress', style: theme.textTheme.titleMedium),
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      '$learned / $total',
                      style: theme.textTheme.headlineSmall,
                    ),
                    Text('$pct% complete', style: theme.textTheme.bodyMedium),
                  ],
                ),
                const SizedBox(height: 8),
                LinearProgressIndicator(value: total > 0 ? learned / total : 0),
                const SizedBox(height: 4),
                Text('mishnayos learned', style: theme.textTheme.bodySmall),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Stats', style: theme.textTheme.titleMedium),
                const SizedBox(height: 12),
                _statRow('Weekly goal', '${data.commitment ?? 0} / week'),
                _statRow('Completion rate', '$pct%'),
                _statRow(
                  'Member since',
                  data.joinedAt != null ? formatLongDate(data.joinedAt!) : '—',
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('By mesechta', style: theme.textTheme.titleMedium),
                const SizedBox(height: 12),
                for (final m in breakdown) ...[
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        m.mesechta,
                        style: theme.textTheme.titleSmall,
                      ),
                      Text(
                        '${m.rows.where((r) => isLearned(r.ref)).length}'
                        ' / ${m.rows.length}',
                        style: theme.textTheme.bodySmall,
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  LinearProgressIndicator(
                    value: m.rows.isEmpty
                        ? 0
                        : m.rows.where((r) => isLearned(r.ref)).length /
                            m.rows.length,
                  ),
                  const SizedBox(height: 12),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _statRow(String label, String value) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: theme.textTheme.bodyMedium!
                .copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          Text(value, style: theme.textTheme.bodyMedium),
        ],
      ),
    );
  }
}

/// The Assignments tab: per-mesechta cards of collapsible mishna rows with
/// learned checkboxes (optimistic toggles via the shared CompletionSync).
class _AssignmentsTab extends StatelessWidget {
  const _AssignmentsTab({required this.data, required this.state});

  final Chaluka data;
  final _MyMishnayosScreenState state;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final groups = groupByMesechta(data);
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: groups.length,
      itemBuilder: (context, i) {
        final g = groups[i];
        final done = g.rows.where((r) => state.isLearned(r.ref)).length;
        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(g.mesechta, style: theme.textTheme.titleMedium),
                      Text(
                        '$done / ${g.rows.length}',
                        style: theme.textTheme.bodyMedium!.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                const Divider(),
                for (final row in g.rows)
                  MishnaDisclosureRow(
                    key: ValueKey(formatRef(row.ref)),
                    mishnaRef: row.ref,
                    done: state.isLearned(row.ref),
                    onToggleLearned: () =>
                        state.toggleCompletion(row.ref, row.groupId),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}
