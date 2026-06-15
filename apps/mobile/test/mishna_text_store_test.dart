import 'package:chevras_mishnayos/data/mishna_text_store.dart';
import 'package:chevras_mishnayos/data/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('looks up Berakhot 1:1 from the bundled assets', () async {
    final store = MishnaTextStore();
    final text = await store.lookup(
      const MishnaRef(mesechta: 'Berakhot', perek: 1, mishna: 1),
    );
    expect(text, isNotNull);
    expect(text!.hebrew, contains('מֵאֵימָתַי'));
    expect(text.english, isNotEmpty);
    expect(text.tractateHebrewName, 'ברכות');
  });

  test('covers every tractate the lot catalog can reference', () async {
    final store = MishnaTextStore();
    // A few names with non-trivial spellings, matching the domain dataset.
    for (final name in ['Pirkei Avot', "Ta'anit", 'Maaser Sheni', 'Oktzin']) {
      final tractate = await store.tractate(name);
      expect(tractate.perakim, isNotEmpty, reason: name);
    }
  });

  test('returns null for an unknown ref', () async {
    final store = MishnaTextStore();
    expect(
      await store.lookup(
        const MishnaRef(mesechta: 'Berakhot', perek: 99, mishna: 1),
      ),
      isNull,
    );
    expect(
      await store.lookup(
        const MishnaRef(mesechta: 'NotATractate', perek: 1, mishna: 1),
      ),
      isNull,
    );
  });
}
