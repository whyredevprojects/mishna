import 'dart:convert';

import 'package:flutter/services.dart' show AssetBundle, rootBundle;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'models.dart';

/// The Hebrew/English text of a single mishna, plus its tractate's Hebrew name.
class MishnaText {
  const MishnaText({
    required this.hebrew,
    required this.english,
    required this.tractateHebrewName,
  });

  final String hebrew;
  final String english;
  final String tractateHebrewName;
}

/// One tractate of the mishna_text dataset (`packages/mishna_text/data/<file>.json`).
class Tractate {
  const Tractate({
    required this.name,
    required this.hebrewName,
    required this.perakim,
  });

  final String name;
  final String hebrewName;
  final List<Perek> perakim;

  factory Tractate.fromJson(Map<String, dynamic> json) => Tractate(
        name: json['name'] as String,
        hebrewName: json['hebrewName'] as String,
        perakim: (json['perakim'] as List)
            .map((p) => Perek.fromJson(p as Map<String, dynamic>))
            .toList(),
      );
}

class Perek {
  const Perek({required this.perek, required this.mishnayot});

  final int perek;
  final List<MishnaEntry> mishnayot;

  factory Perek.fromJson(Map<String, dynamic> json) => Perek(
        perek: json['perek'] as int,
        mishnayot: (json['mishnayot'] as List)
            .map((m) => MishnaEntry.fromJson(m as Map<String, dynamic>))
            .toList(),
      );
}

class MishnaEntry {
  const MishnaEntry({
    required this.mishna,
    required this.hebrew,
    required this.english,
  });

  final int mishna;
  final String hebrew;
  final String english;

  factory MishnaEntry.fromJson(Map<String, dynamic> json) => MishnaEntry(
        mishna: json['mishna'] as int,
        hebrew: json['hebrew'] as String,
        english: json['english'] as String,
      );
}

/// Loads and caches Mishna text from the mishna_text package's JSON, bundled
/// as package assets (declared in pubspec under packages/mishna_text/data/).
/// index.json maps tractate names ("Berakhot" — the same names
/// MishnaRef.mesechta carries) to file names, so only opened tractates are
/// parsed.
class MishnaTextStore {
  MishnaTextStore({AssetBundle? bundle}) : _bundle = bundle ?? rootBundle;

  static const _assetDir = 'packages/mishna_text/data';

  final AssetBundle _bundle;
  Map<String, String>? _index;
  final _tractates = <String, Future<Tractate>>{};

  Future<Map<String, String>> _loadIndex() async {
    if (_index != null) return _index!;
    final raw = await _bundle.loadString('$_assetDir/index.json');
    _index = (jsonDecode(raw) as Map<String, dynamic>).cast<String, String>();
    return _index!;
  }

  /// The full tractate, parsed once and cached for the app's lifetime.
  Future<Tractate> tractate(String mesechta) {
    return _tractates.putIfAbsent(mesechta, () async {
      final index = await _loadIndex();
      final file = index[mesechta];
      if (file == null) {
        throw ArgumentError('Tractate not found: $mesechta');
      }
      final raw = await _bundle.loadString('$_assetDir/$file');
      return Tractate.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    });
  }

  /// The text for one mishna, or null if the ref isn't in the dataset.
  Future<MishnaText?> lookup(MishnaRef ref) async {
    final Tractate t;
    try {
      t = await tractate(ref.mesechta);
    } on ArgumentError {
      return null;
    }
    for (final perek in t.perakim) {
      if (perek.perek != ref.perek) continue;
      for (final mishna in perek.mishnayot) {
        if (mishna.mishna == ref.mishna) {
          return MishnaText(
            hebrew: mishna.hebrew,
            english: mishna.english,
            tractateHebrewName: t.hebrewName,
          );
        }
      }
    }
    return null;
  }
}

final mishnaTextStoreProvider = Provider<MishnaTextStore>(
  (ref) => MishnaTextStore(),
);
