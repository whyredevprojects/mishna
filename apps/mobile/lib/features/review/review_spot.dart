import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../../data/models.dart';

const _key = 'review-spot';

/// The last mishna viewed in the Review browser, persisted across launches
/// (the mobile analog of the web client's localStorage review spot).
Future<MishnaRef?> loadReviewSpot() async {
  final prefs = await SharedPreferences.getInstance();
  final raw = prefs.getString(_key);
  if (raw == null) return null;
  try {
    return MishnaRef.fromJson(jsonDecode(raw) as Map<String, dynamic>);
  } catch (_) {
    return null;
  }
}

Future<void> saveReviewSpot(MishnaRef ref) async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.setString(_key, jsonEncode(ref.toJson()));
}
