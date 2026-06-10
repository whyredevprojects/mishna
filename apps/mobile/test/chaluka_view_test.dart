import 'package:chevras_mishnayos/data/chaluka_view.dart';
import 'package:chevras_mishnayos/data/models.dart';
import 'package:flutter_test/flutter_test.dart';

MishnaRef ref(String m, int p, int n) =>
    MishnaRef(mesechta: m, perek: p, mishna: n);

void main() {
  final chaluka = Chaluka(
    commitment: 2,
    joinedAt: '2026-06-01T00:00:00.000Z',
    assigned: [
      ref('Peah', 1, 1),
      ref('Peah', 1, 2),
      ref('Peah', 2, 1),
      ref('Demai', 1, 1),
    ],
    completed: [ref('Peah', 1, 2)],
    groupIds: const ['g1', 'g1', 'g1', 'g2'],
  );

  test('groupByMesechta keeps corpus order and per-ref group ids', () {
    final groups = groupByMesechta(chaluka);
    expect(groups.map((g) => g.mesechta), ['Peah', 'Demai']);
    expect(groups.first.rows, hasLength(3));
    expect(groups.first.rows.first.groupId, 'g1');
    expect(groups.last.rows.single.groupId, 'g2');
  });

  test('groupByPerek splits a mesechta into perakim in order', () {
    final groups = groupByPerek(chaluka);
    final peah = groups.first;
    expect(peah.mesechta, 'Peah');
    expect(peah.perakim.map((p) => p.perek), [1, 2]);
    expect(peah.perakim.first.refs, hasLength(2));
    expect(peah.total, 3);
    expect(groups.last.perakim.single.refs.single, ref('Demai', 1, 1));
  });

  test('empty chaluka yields no groups', () {
    const empty = Chaluka(
      commitment: null,
      joinedAt: null,
      assigned: [],
      completed: [],
      groupIds: [],
    );
    expect(groupByMesechta(empty), isEmpty);
    expect(groupByPerek(empty), isEmpty);
  });
}
