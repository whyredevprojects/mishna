import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/formatting.dart';
import '../data/models.dart';
import '../data/repositories.dart';

const _syncError =
    "We weren't able to update your progress. Please try again later.";

/// Optimistic "learned" toggling, shared by the Dashboard and My Mishnayos
/// screens (the same pattern the web client uses): the screen holds a local
/// set of learned-ref keys seeded from the server, each toggle applies
/// immediately and syncs in the background, a failed sync reverts the toggle
/// and shows a snackbar, and a settled sync invalidates the cached reads so
/// every view re-derives from the server.
///
/// Screens call [seedCompletions] during build with the loaded data object;
/// it re-seeds only when the data's identity changes (initial load or a
/// refetch — the analog of the web client's effect on the query data), so
/// optimistic toggles between fetches are preserved.
mixin CompletionSync<T extends ConsumerStatefulWidget> on ConsumerState<T> {
  final Set<String> checked = {};
  Object? _seededFrom;

  /// Replace the local learned set with the server's, once per `data`
  /// identity. Safe to call during build (mutates state without setState; the
  /// in-flight build already sees the new values).
  void seedCompletions(Object data, Iterable<MishnaRef> completed) {
    if (identical(data, _seededFrom)) return;
    _seededFrom = data;
    checked
      ..clear()
      ..addAll(completed.map(formatRef));
  }

  bool isLearned(MishnaRef ref) => checked.contains(formatRef(ref));

  /// Flip a mishna's learned state: optimistic local update, then sync; on
  /// failure revert + snackbar. `groupId` is the group the completion is
  /// recorded under (from the assignment/chaluka).
  Future<void> toggleCompletion(MishnaRef ref, String? groupId) async {
    if (groupId == null) return;
    final key = formatRef(ref);
    final learn = !checked.contains(key);
    setState(() {
      learn ? checked.add(key) : checked.remove(key);
    });
    final api = this.ref.read(apiRepositoryProvider);
    try {
      if (learn) {
        await api.markLearned(ref, groupId);
      } else {
        await api.markUnlearned(ref, groupId);
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        learn ? checked.remove(key) : checked.add(key);
      });
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text(_syncError)));
      return;
    }
    // Keep the server-derived caches authoritative; their refetch re-seeds the
    // screens (and already reflects this toggle). Invalidate every cached bucket
    // (and the current view), since the toggle may move the next-unlearned bucket.
    this.ref.invalidate(assignmentProvider);
    this.ref.invalidate(chalukaProvider);
  }
}
