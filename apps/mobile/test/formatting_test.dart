import 'package:chevras_mishnayos/core/formatting.dart';
import 'package:chevras_mishnayos/data/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('formatRef renders "Mesechta perek:mishna"', () {
    expect(
      formatRef(const MishnaRef(mesechta: 'Berakhot', perek: 1, mishna: 2)),
      'Berakhot 1:2',
    );
  });

  test('formatRefHe renders the Hebrew label', () {
    expect(formatRefHe('ברכות', 8, 7), 'ברכות פרק 8 משנה 7');
  });

  test('toIsoDate emits YYYY-MM-DD in UTC', () {
    expect(toIsoDate(DateTime.utc(2026, 6, 9, 23, 59)), '2026-06-09');
  });

  test('formatLongDate reads date-only strings as UTC', () {
    expect(formatLongDate('2026-06-02'), contains('June 2, 2026'));
    expect(formatLongDate('2026-06-02T00:00:00.000Z'), contains('June 2'));
  });
}
