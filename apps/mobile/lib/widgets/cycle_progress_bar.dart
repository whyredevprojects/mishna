import 'package:flutter/material.dart';

import '../data/models.dart';

/// Cycle progress bar + "N days remaining" caption.
class CycleProgressBar extends StatelessWidget {
  const CycleProgressBar({super.key, required this.cycle});

  final Cycle cycle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final fraction =
        cycle.totalDays > 0 ? cycle.daysElapsed / cycle.totalDays : 0.0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('Cycle progress', style: theme.textTheme.bodySmall),
            Text(
              'Day ${cycle.daysElapsed} / ${cycle.totalDays}',
              style: theme.textTheme.bodySmall,
            ),
          ],
        ),
        const SizedBox(height: 4),
        LinearProgressIndicator(value: fraction.clamp(0.0, 1.0)),
        const SizedBox(height: 4),
        Text(
          '${cycle.daysRemaining} days remaining until Rosh Chodesh Sivan',
          style: theme.textTheme.bodySmall,
          textAlign: TextAlign.center,
        ),
      ],
    );
  }
}
