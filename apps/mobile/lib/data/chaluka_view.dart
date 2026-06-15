/// Pure grouping helpers over the chaluka (whole-cycle portion) — the mobile
/// counterpart of the Angular pages' computed groupings. Kept framework-free
/// so they're unit-testable.
library;

import 'models.dart';

/// One mishna of the portion plus the group its completion is recorded under.
class PortionRow {
  const PortionRow({required this.ref, required this.groupId});

  final MishnaRef ref;
  final String groupId;
}

/// One mesechta's slice of the portion, in corpus order.
class MesechtaPortion {
  MesechtaPortion({required this.mesechta}) : rows = [];

  final String mesechta;
  final List<PortionRow> rows;
}

/// The portion grouped by mesechta, in corpus order (assigned is
/// corpus-ordered, so first-seen order is correct).
List<MesechtaPortion> groupByMesechta(Chaluka chaluka) {
  final byMesechta = <String, MesechtaPortion>{};
  final groups = <MesechtaPortion>[];
  for (var i = 0; i < chaluka.assigned.length; i++) {
    final ref = chaluka.assigned[i];
    var group = byMesechta[ref.mesechta];
    if (group == null) {
      group = MesechtaPortion(mesechta: ref.mesechta);
      byMesechta[ref.mesechta] = group;
      groups.add(group);
    }
    group.rows.add(PortionRow(ref: ref, groupId: chaluka.groupIds[i]));
  }
  return groups;
}

/// One perek's worth of the portion.
class PerekPortion {
  PerekPortion({required this.perek}) : refs = [];

  final int perek;
  final List<MishnaRef> refs;
}

/// One mesechta's worth of the portion, split into perakim.
class MesechtaPerakim {
  MesechtaPerakim({required this.mesechta}) : perakim = [];

  final String mesechta;
  final List<PerekPortion> perakim;

  int get total =>
      perakim.fold(0, (sum, p) => sum + p.refs.length);
}

/// The portion grouped mesechta → perek → mishna, in corpus order (the Review
/// browser's navigation tree).
List<MesechtaPerakim> groupByPerek(Chaluka chaluka) {
  final groups = <MesechtaPerakim>[];
  final byMesechta = <String, MesechtaPerakim>{};
  final byPerek = <String, PerekPortion>{};
  for (final ref in chaluka.assigned) {
    var m = byMesechta[ref.mesechta];
    if (m == null) {
      m = MesechtaPerakim(mesechta: ref.mesechta);
      byMesechta[ref.mesechta] = m;
      groups.add(m);
    }
    final perekKey = '${ref.mesechta} ${ref.perek}';
    var p = byPerek[perekKey];
    if (p == null) {
      p = PerekPortion(perek: ref.perek);
      byPerek[perekKey] = p;
      m.perakim.add(p);
    }
    p.refs.add(ref);
  }
  return groups;
}
