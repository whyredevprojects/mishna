import 'package:flutter/material.dart';

/// Commitment picker (1/2/3 mishnayot per week) + Join button.
class JoinForm extends StatefulWidget {
  const JoinForm({super.key, required this.onJoin, this.loading = false});

  final ValueChanged<int> onJoin;
  final bool loading;

  @override
  State<JoinForm> createState() => _JoinFormState();
}

class _JoinFormState extends State<JoinForm> {
  int _commitment = 1;

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
            const SizedBox(height: 12),
            SegmentedButton<int>(
              segments: const [
                ButtonSegment(value: 1, label: Text('1')),
                ButtonSegment(value: 2, label: Text('2')),
                ButtonSegment(value: 3, label: Text('3')),
              ],
              selected: {_commitment},
              onSelectionChanged: (selection) =>
                  setState(() => _commitment = selection.first),
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
