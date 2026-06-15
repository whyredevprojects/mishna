import 'package:chevras_mishnayos/data/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('MishnaRef has value equality and JSON round-trip', () {
    const ref = MishnaRef(mesechta: 'Berakhot', perek: 1, mishna: 2);
    expect(MishnaRef.fromJson(ref.toJson()), ref);
    expect(
      ref,
      isNot(const MishnaRef(mesechta: 'Berakhot', perek: 1, mishna: 3)),
    );
    expect({ref}, contains(MishnaRef.fromJson(ref.toJson())));
  });

  test('Me parses joined and not-joined shapes', () {
    final joined = Me.fromJson({
      'joined': true,
      'commitment': 2,
      'user': {'id': 'u1', 'name': 'Test', 'email': 't@e.st', 'role': null},
      'isAdmin': false,
    });
    expect(joined.joined, isTrue);
    expect(joined.commitment, 2);
    expect(joined.user.name, 'Test');
    expect(joined.isAdmin, isFalse);

    final fresh = Me.fromJson({
      'joined': false,
      'commitment': null,
      'user': {'id': 'u2', 'name': null, 'email': null, 'role': null},
      'isAdmin': true,
    });
    expect(fresh.joined, isFalse);
    expect(fresh.commitment, isNull);
    expect(fresh.isAdmin, isTrue);
  });

  test('Assignment parses with null groupId on an empty week', () {
    final a = Assignment.fromJson({
      'userId': 'u1',
      'date': '2026-06-09T00:00:00.000Z',
      'mishnas': <dynamic>[],
      'groupId': null,
      'completed': <dynamic>[],
    });
    expect(a.mishnas, isEmpty);
    expect(a.groupId, isNull);
  });

  test('Chaluka keeps assigned and groupIds in lockstep', () {
    final c = Chaluka.fromJson({
      'commitment': 1,
      'joinedAt': '2026-06-01T00:00:00.000Z',
      'assigned': [
        {'mesechta': 'Peah', 'perek': 1, 'mishna': 1},
        {'mesechta': 'Peah', 'perek': 1, 'mishna': 2},
      ],
      'completed': [
        {'mesechta': 'Peah', 'perek': 1, 'mishna': 1},
      ],
      'groupIds': ['g1', 'g2'],
    });
    expect(c.assigned, hasLength(2));
    expect(c.groupIds, ['g1', 'g2']);
    expect(c.completed.single.mishna, 1);
  });

  test('EmailPrefs JSON round-trip and copyWith', () {
    const prefs = EmailPrefs(
      timezone: 'Asia/Jerusalem',
      weeklyEmailDow: 0,
      reminderEmailDow: 4,
      weeklyEnabled: true,
      reminderEnabled: false,
    );
    final parsed = EmailPrefs.fromJson(prefs.toJson());
    expect(parsed.timezone, 'Asia/Jerusalem');
    expect(parsed.reminderEnabled, isFalse);
    expect(parsed.copyWith(weeklyEmailDow: 3).weeklyEmailDow, 3);
    expect(parsed.copyWith(weeklyEmailDow: 3).timezone, 'Asia/Jerusalem');
  });
}
