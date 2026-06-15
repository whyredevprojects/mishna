import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/formatting.dart';
import '../data/mishna_text_store.dart';
import '../data/models.dart';

/// One mishna's text, cached by ref (MishnaRef has value equality, so the
/// family dedupes; rebuilds don't re-trigger loads or spinner flashes).
final mishnaTextProvider = FutureProvider.family<MishnaText?, MishnaRef>(
  (ref, mishnaRef) => ref.watch(mishnaTextStoreProvider).lookup(mishnaRef),
);

/// The Hebrew (and optionally English) text of one mishna, loaded from the
/// bundled mishna_text assets. Hebrew renders RTL, centered, large.
class MishnaTextBody extends ConsumerWidget {
  const MishnaTextBody({
    super.key,
    required this.mishnaRef,
    this.showEnglish = false,
  });

  final MishnaRef mishnaRef;
  final bool showEnglish;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final async = ref.watch(mishnaTextProvider(mishnaRef));
    return async.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (_, _) => Text(
        'Text unavailable for this mishna.',
        style: theme.textTheme.bodyMedium!
            .copyWith(color: theme.colorScheme.outline),
      ),
      data: (text) {
        if (text == null) {
          return Text(
            'Text unavailable for this mishna.',
            style: theme.textTheme.bodyMedium!
                .copyWith(color: theme.colorScheme.outline),
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              text.hebrew,
              textDirection: TextDirection.rtl,
              textAlign: TextAlign.center,
              style: theme.textTheme.titleLarge!.copyWith(height: 2),
            ),
            if (showEnglish) ...[
              const Divider(height: 24),
              Text(
                text.english,
                style: theme.textTheme.bodyMedium!.copyWith(
                  height: 1.6,
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ],
        );
      },
    );
  }
}

/// One mishna as a full card: ref header (with the Hebrew label once the text
/// loads), Hebrew text, an English toggle, and optionally the "I Learned This
/// Baal Peh" checkbox. Used by the Dashboard (this week) and Review screens.
class MishnaCard extends ConsumerStatefulWidget {
  const MishnaCard({
    super.key,
    required this.mishnaRef,
    required this.done,
    this.onToggleLearned,
    this.showEnglishToggle = true,
    this.showEnglish,
  });

  final MishnaRef mishnaRef;
  final bool done;

  /// Renders the learned checkbox when non-null.
  final VoidCallback? onToggleLearned;

  /// Show the card's own English toggle; pass [showEnglish] instead when a
  /// parent owns English visibility (the Review screen's shared toggle).
  final bool showEnglishToggle;
  final bool? showEnglish;

  @override
  ConsumerState<MishnaCard> createState() => _MishnaCardState();
}

class _MishnaCardState extends ConsumerState<MishnaCard> {
  bool _showEnglish = false;

  bool get _english => widget.showEnglish ?? _showEnglish;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  formatRef(widget.mishnaRef),
                  style: theme.textTheme.titleMedium,
                ),
                if (widget.done && widget.onToggleLearned == null)
                  Icon(
                    Icons.check_circle,
                    color: theme.colorScheme.primary,
                    size: 20,
                  ),
              ],
            ),
            const SizedBox(height: 12),
            MishnaTextBody(mishnaRef: widget.mishnaRef, showEnglish: _english),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                if (widget.showEnglishToggle)
                  TextButton.icon(
                    onPressed: () =>
                        setState(() => _showEnglish = !_showEnglish),
                    icon: const Icon(Icons.translate, size: 18),
                    label: Text(_showEnglish ? 'Hide English' : 'English'),
                  )
                else
                  const SizedBox.shrink(),
                if (widget.onToggleLearned != null)
                  Flexible(
                    child: InkWell(
                      onTap: widget.onToggleLearned,
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Checkbox(
                            value: widget.done,
                            onChanged: (_) => widget.onToggleLearned!(),
                          ),
                          const Flexible(
                            child: Text('I Learned This Baal Peh'),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// One mishna as a compact disclosure row (the My Mishnayos list): "perek:mishna"
/// + a learned checkbox; tapping the heading expands the text inline, loading
/// it only then — so a long list doesn't parse a tractate per row up front.
class MishnaDisclosureRow extends StatefulWidget {
  const MishnaDisclosureRow({
    super.key,
    required this.mishnaRef,
    required this.done,
    required this.onToggleLearned,
  });

  final MishnaRef mishnaRef;
  final bool done;
  final VoidCallback onToggleLearned;

  @override
  State<MishnaDisclosureRow> createState() => _MishnaDisclosureRowState();
}

class _MishnaDisclosureRowState extends State<MishnaDisclosureRow> {
  bool _expanded = false;
  bool _showEnglish = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: InkWell(
                onTap: () => setState(() => _expanded = !_expanded),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Row(
                    children: [
                      Icon(
                        _expanded
                            ? Icons.keyboard_arrow_down
                            : Icons.keyboard_arrow_right,
                        size: 20,
                        color: theme.colorScheme.outline,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        '${widget.mishnaRef.perek}:${widget.mishnaRef.mishna}',
                        style: theme.textTheme.bodyLarge,
                      ),
                    ],
                  ),
                ),
              ),
            ),
            // Sibling of the disclosure trigger, so toggling never expands.
            Checkbox(
              value: widget.done,
              onChanged: (_) => widget.onToggleLearned(),
              semanticLabel: 'Mark ${formatRef(widget.mishnaRef)} memorized',
            ),
          ],
        ),
        if (_expanded)
          Padding(
            padding: const EdgeInsets.only(left: 26, bottom: 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                MishnaTextBody(
                  mishnaRef: widget.mishnaRef,
                  showEnglish: _showEnglish,
                ),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton.icon(
                    onPressed: () =>
                        setState(() => _showEnglish = !_showEnglish),
                    icon: const Icon(Icons.translate, size: 18),
                    label: Text(_showEnglish ? 'Hide English' : 'English'),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
