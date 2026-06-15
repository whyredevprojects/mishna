import 'package:flutter/material.dart';

import '../data/models.dart';

/// Commitment picker + Join button. Choices are framed as mishnayot per week,
/// but each shows roughly how many lots (chalakim) it commits to from now to the
/// end of the cycle — fewer as the cycle progresses, collapsing to a single
/// "1 lot" option near the end. Options come from the server (`/api/join-options`)
/// so the lot math lives in one place.
class JoinForm extends StatefulWidget {
  const JoinForm({
    super.key,
    required this.onJoin,
    required this.options,
    this.loading = false,
  });

  final ValueChanged<int> onJoin;
  final List<JoinOption> options;
  final bool loading;

  @override
  State<JoinForm> createState() => _JoinFormState();
}

class _JoinFormState extends State<JoinForm> {
  late int _commitment = widget.options.first.commitment;

  @override
  void didUpdateWidget(JoinForm oldWidget) {
    super.didUpdateWidget(oldWidget);
    // The previously-selected pace may have been dropped near the cycle end.
    if (!widget.options.any((o) => o.commitment == _commitment)) {
      _commitment = widget.options.first.commitment;
    }
  }

  String _mainLabel(JoinOption o) {
    if (o.singleLot) return '1 lot';
    final noun = o.commitment == 1 ? 'mishna' : 'mishnayos';
    return '${o.commitment} $noun a week';
  }

  String _subLabel(JoinOption o) {
    if (o.singleLot) {
      return 'up to ${o.maxMishnas} mishnayos · about ${o.perDay} a day';
    }
    return 'about ${o.approxLots} ${o.approxLots == 1 ? 'lot' : 'lots'}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Join the current cycle', style: theme.textTheme.titleMedium),
            const SizedBox(height: 12),
            const Text('How many mishnayot will you learn each week?'),
            const SizedBox(height: 4),
            RadioGroup<int>(
              groupValue: _commitment,
              onChanged: (v) => setState(() => _commitment = v!),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final o in widget.options)
                    RadioListTile<int>(
                      value: o.commitment,
                      contentPadding: EdgeInsets.zero,
                      title: Text(_mainLabel(o)),
                      subtitle: Text(_subLabel(o)),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed:
                  widget.loading ? null : () => widget.onJoin(_commitment),
              child: widget.loading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Join'),
            ),
          ],
        ),
      ),
    );
  }
}
