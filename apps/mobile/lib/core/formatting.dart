import 'package:intl/intl.dart';

import '../data/models.dart';

/// "Berakhot 1:1" — the human-readable label for a single mishna, and the key
/// completion sets are tracked under (mirrors the web client's formatRef).
String formatRef(MishnaRef ref) => '${ref.mesechta} ${ref.perek}:${ref.mishna}';

/// Hebrew label for a mishna, e.g. "ברכות פרק 8 משנה 7".
String formatRefHe(String hebrewName, int perek, int mishna) =>
    '$hebrewName פרק $perek משנה $mishna';

/// A Date as the `YYYY-MM-DD` (UTC) string the assignments API expects.
String toIsoDate(DateTime date) =>
    date.toUtc().toIso8601String().substring(0, 10);

/// A friendly "Tuesday, June 2, 2026" for display, read in UTC.
String formatLongDate(String iso) {
  final date = DateTime.parse(iso.length == 10 ? '${iso}T00:00:00.000Z' : iso);
  return DateFormat.yMMMMEEEEd().format(date.toUtc());
}
