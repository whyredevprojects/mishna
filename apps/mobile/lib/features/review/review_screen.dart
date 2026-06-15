import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/formatting.dart';
import '../../data/chaluka_view.dart';
import '../../data/models.dart';
import '../../data/repositories.dart';
import '../../widgets/mishna_card.dart';
import 'review_spot.dart';

/// Review browser over the caller's whole-cycle portion: pick a mesechta +
/// perek from your allotment and read the whole perek (each mishna with one
/// shared English toggle), with a mishna strip showing which are learned and
/// jumping to a mishna. The last spot is restored on return.
class ReviewScreen extends ConsumerStatefulWidget {
  const ReviewScreen({super.key});

  @override
  ConsumerState<ReviewScreen> createState() => _ReviewScreenState();
}

class _ReviewScreenState extends ConsumerState<ReviewScreen> {
  MishnaRef? _selected;
  bool _showEnglish = false;
  bool _initialized = false;

  /// Anchor keys for the current perek's cards, so the strip can scroll to one.
  final _cardKeys = <String, GlobalKey>{};

  Future<void> _initSelection(List<MesechtaPerakim> groups) async {
    if (_initialized || groups.isEmpty) return;
    _initialized = true;
    final saved = await loadReviewSpot();
    final assigned = ref.read(chalukaProvider).value?.assigned ?? [];
    final start = saved != null && assigned.contains(saved)
        ? saved
        : groups.first.perakim.first.refs.first;
    if (!mounted) return;
    setState(() => _selected = start);
    _scheduleScroll(start);
  }

  void _goTo(MishnaRef target) {
    setState(() => _selected = target);
    saveReviewSpot(target);
    _scheduleScroll(target);
  }

  void _scheduleScroll(MishnaRef target) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final key = _cardKeys[formatRef(target)];
      final ctx = key?.currentContext;
      if (ctx != null) {
        Scrollable.ensureVisible(
          ctx,
          duration: const Duration(milliseconds: 300),
          alignment: 0,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final chaluka = ref.watch(chalukaProvider);
    final data = chaluka.value;

    if (data == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Review')),
        body: Center(
          child: chaluka.hasError
              ? const Text('Could not load your portion.')
              : const CircularProgressIndicator(),
        ),
      );
    }

    final groups = groupByPerek(data);
    if (groups.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: const Text('Review')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              "You haven't joined the cycle yet. Pick a commitment on the "
              'Today tab to get your chaluka.',
              style: theme.textTheme.bodyLarge,
              textAlign: TextAlign.center,
            ),
          ),
        ),
      );
    }

    _initSelection(groups);
    final sel = _selected;
    if (sel == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Review')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    final done = {for (final r in data.completed) formatRef(r)};
    final mesechta = groups.firstWhere(
      (m) => m.mesechta == sel.mesechta,
      orElse: () => groups.first,
    );
    final perek = mesechta.perakim.firstWhere(
      (p) => p.perek == sel.perek,
      orElse: () => mesechta.perakim.first,
    );

    _cardKeys
      ..clear()
      ..addEntries(
        perek.refs.map((r) => MapEntry(formatRef(r), GlobalKey())),
      );

    return Scaffold(
      appBar: AppBar(
        title: const Text('Review'),
        actions: [
          IconButton(
            tooltip: _showEnglish ? 'Hide English' : 'Show English',
            icon: Icon(
              Icons.translate,
              color: _showEnglish ? theme.colorScheme.primary : null,
            ),
            onPressed: () => setState(() => _showEnglish = !_showEnglish),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: DropdownMenu<String>(
                        label: const Text('Mesechta'),
                        initialSelection: mesechta.mesechta,
                        expandedInsets: EdgeInsets.zero,
                        dropdownMenuEntries: [
                          for (final m in groups)
                            DropdownMenuEntry(
                              value: m.mesechta,
                              label:
                                  '${m.mesechta} (${m.perakim.expand((p) => p.refs).where((r) => done.contains(formatRef(r))).length}/${m.total})',
                            ),
                        ],
                        onSelected: (name) {
                          final g = groups
                              .where((m) => m.mesechta == name)
                              .firstOrNull;
                          if (g != null) {
                            _goTo(g.perakim.first.refs.first);
                          }
                        },
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: DropdownMenu<int>(
                        label: const Text('Perek'),
                        initialSelection: perek.perek,
                        expandedInsets: EdgeInsets.zero,
                        dropdownMenuEntries: [
                          for (final p in mesechta.perakim)
                            DropdownMenuEntry(
                              value: p.perek,
                              label:
                                  'Perek ${p.perek} (${p.refs.where((r) => done.contains(formatRef(r))).length}/${p.refs.length})',
                            ),
                        ],
                        onSelected: (perekNum) {
                          final p = mesechta.perakim
                              .where((p) => p.perek == perekNum)
                              .firstOrNull;
                          if (p != null) {
                            _goTo(p.refs.first);
                          }
                        },
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                // The mishna strip: jump buttons, dimmed when not yet learned.
                SizedBox(
                  height: 40,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    children: [
                      for (final r in perek.refs)
                        Padding(
                          padding: const EdgeInsets.only(right: 4),
                          child: _StripChip(
                            label: '${r.mishna}',
                            active: r == sel,
                            learned: done.contains(formatRef(r)),
                            onTap: () => _goTo(r),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                for (final r in perek.refs)
                  Container(
                    key: _cardKeys[formatRef(r)],
                    child: MishnaCard(
                      mishnaRef: r,
                      done: done.contains(formatRef(r)),
                      showEnglishToggle: false,
                      showEnglish: _showEnglish,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StripChip extends StatelessWidget {
  const _StripChip({
    required this.label,
    required this.active,
    required this.learned,
    required this.onTap,
  });

  final String label;
  final bool active;
  final bool learned;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final background = active
        ? scheme.primary
        : learned
            ? scheme.secondaryContainer
            : scheme.surfaceContainerHighest;
    final foreground = active
        ? scheme.onPrimary
        : learned
            ? scheme.onSecondaryContainer
            : scheme.onSurfaceVariant;
    return Material(
      color: background,
      shape: const StadiumBorder(),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          child: Opacity(
            opacity: active || learned ? 1 : 0.6,
            child: Text(label, style: TextStyle(color: foreground)),
          ),
        ),
      ),
    );
  }
}
