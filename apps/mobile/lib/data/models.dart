/// Dart shapes of the apps/server REST responses — the mobile counterpart of
/// the web client's models/api.types.ts. Dates arrive as ISO strings and are
/// kept as strings unless something needs date math.
library;

/// One mishna in the corpus. `mesechta` uses the Sefaria-style English names
/// the domain dataset carries ("Berakhot", "Pirkei Avot", …), which are also
/// the keys of the mishna_text index.
class MishnaRef {
  const MishnaRef({
    required this.mesechta,
    required this.perek,
    required this.mishna,
  });

  final String mesechta;
  final int perek;
  final int mishna;

  factory MishnaRef.fromJson(Map<String, dynamic> json) => MishnaRef(
        mesechta: json['mesechta'] as String,
        perek: json['perek'] as int,
        mishna: json['mishna'] as int,
      );

  Map<String, dynamic> toJson() =>
      {'mesechta': mesechta, 'perek': perek, 'mishna': mishna};

  @override
  bool operator ==(Object other) =>
      other is MishnaRef &&
      other.mesechta == mesechta &&
      other.perek == perek &&
      other.mishna == mishna;

  @override
  int get hashCode => Object.hash(mesechta, perek, mishna);

  @override
  String toString() => '$mesechta $perek:$mishna';
}

/// The signed-in user's identity, as carried on GET /api/me.
class UserInfo {
  const UserInfo({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
  });

  final String id;
  final String? name;
  final String? email;
  final String? role;

  factory UserInfo.fromJson(Map<String, dynamic> json) => UserInfo(
        id: json['id'] as String,
        name: json['name'] as String?,
        email: json['email'] as String?,
        role: json['role'] as String?,
      );
}

/// GET /api/me — session + join status.
class Me {
  const Me({
    required this.joined,
    required this.commitment,
    required this.user,
    required this.isAdmin,
  });

  final bool joined;

  /// Mishnayos per week (1, 2, or 3), or null before joining.
  final int? commitment;
  final UserInfo user;
  final bool isAdmin;

  factory Me.fromJson(Map<String, dynamic> json) => Me(
        joined: json['joined'] as bool,
        commitment: json['commitment'] as int?,
        user: UserInfo.fromJson(json['user'] as Map<String, dynamic>),
        isAdmin: json['isAdmin'] == true,
      );
}

/// GET/PUT /api/me/preferences — the user's email settings. Days are 0=Sunday
/// … 6=Saturday (matches the server).
class EmailPrefs {
  const EmailPrefs({
    required this.timezone,
    required this.weeklyEmailDow,
    required this.reminderEmailDow,
    required this.weeklyEnabled,
    required this.reminderEnabled,
  });

  final String timezone;
  final int weeklyEmailDow;
  final int reminderEmailDow;
  final bool weeklyEnabled;
  final bool reminderEnabled;

  factory EmailPrefs.fromJson(Map<String, dynamic> json) => EmailPrefs(
        timezone: json['timezone'] as String,
        weeklyEmailDow: json['weeklyEmailDow'] as int,
        reminderEmailDow: json['reminderEmailDow'] as int,
        weeklyEnabled: json['weeklyEnabled'] == true,
        reminderEnabled: json['reminderEnabled'] == true,
      );

  Map<String, dynamic> toJson() => {
        'timezone': timezone,
        'weeklyEmailDow': weeklyEmailDow,
        'reminderEmailDow': reminderEmailDow,
        'weeklyEnabled': weeklyEnabled,
        'reminderEnabled': reminderEnabled,
      };

  EmailPrefs copyWith({
    String? timezone,
    int? weeklyEmailDow,
    int? reminderEmailDow,
    bool? weeklyEnabled,
    bool? reminderEnabled,
  }) =>
      EmailPrefs(
        timezone: timezone ?? this.timezone,
        weeklyEmailDow: weeklyEmailDow ?? this.weeklyEmailDow,
        reminderEmailDow: reminderEmailDow ?? this.reminderEmailDow,
        weeklyEnabled: weeklyEnabled ?? this.weeklyEnabled,
        reminderEnabled: reminderEnabled ?? this.reminderEnabled,
      );
}

/// GET /api/cycle — bounds and progress of the current learning cycle.
class Cycle {
  const Cycle({
    required this.cycleStart,
    required this.cycleEnd,
    required this.daysElapsed,
    required this.daysRemaining,
    required this.totalDays,
  });

  final String cycleStart;
  final String cycleEnd;
  final int daysElapsed;
  final int daysRemaining;
  final int totalDays;

  factory Cycle.fromJson(Map<String, dynamic> json) => Cycle(
        cycleStart: json['cycleStart'] as String,
        cycleEnd: json['cycleEnd'] as String,
        daysElapsed: json['daysElapsed'] as int,
        daysRemaining: json['daysRemaining'] as int,
        totalDays: json['totalDays'] as int,
      );
}

/// One signup commitment choice (GET /api/join-options). Framed as a weekly pace
/// but annotated with the approximate lots it commits to from now to the cycle
/// end; near the end the slower paces collapse into a single "1 lot" option.
class JoinOption {
  const JoinOption({
    required this.commitment,
    required this.approxLots,
    required this.singleLot,
    this.maxMishnas,
    this.perDay,
  });

  final int commitment;
  final int approxLots;
  final bool singleLot;

  /// Set only when [singleLot]: the largest a single lot can be.
  final int? maxMishnas;

  /// Set only when [singleLot]: mishnayot per day to finish that lot in time.
  final int? perDay;

  factory JoinOption.fromJson(Map<String, dynamic> json) => JoinOption(
        commitment: json['commitment'] as int,
        approxLots: json['approxLots'] as int,
        singleLot: json['singleLot'] as bool,
        maxMishnas: json['maxMishnas'] as int?,
        perDay: json['perDay'] as int?,
      );
}

/// GET /api/assignments/today — the current (next-unlearned) bucket plus
/// completion state, and `?bucket=N` for an explicit pager bucket.
class Assignment {
  const Assignment({
    required this.userId,
    required this.date,
    required this.mishnas,
    required this.groupId,
    required this.completed,
    required this.bucket,
    required this.bucketCount,
    required this.currentBucket,
  });

  final String userId;
  final String date;
  final List<MishnaRef> mishnas;

  /// The group completions are recorded under; null when the bucket is empty.
  final String? groupId;

  /// The subset of [mishnas] already marked learned.
  final List<MishnaRef> completed;

  /// The bucket index this response represents (the pager's position).
  final int bucket;

  /// Total number of pace-sized buckets in the caller's whole portion.
  final int bucketCount;

  /// The current (next-unlearned) bucket index; equals [bucketCount] once finished.
  final int currentBucket;

  factory Assignment.fromJson(Map<String, dynamic> json) => Assignment(
        userId: json['userId'] as String,
        date: json['date'] as String,
        mishnas: _refList(json['mishnas']),
        groupId: json['groupId'] as String?,
        completed: _refList(json['completed']),
        bucket: json['bucket'] as int? ?? 0,
        bucketCount: json['bucketCount'] as int? ?? 0,
        currentBucket: json['currentBucket'] as int? ?? 0,
      );
}

/// GET /api/me/chaluka — the caller's whole-cycle portion. `groupIds` is
/// parallel to `assigned`: the group a completion for `assigned[i]` is
/// recorded under.
class Chaluka {
  const Chaluka({
    required this.commitment,
    required this.joinedAt,
    required this.assigned,
    required this.completed,
    required this.groupIds,
  });

  final int? commitment;
  final String? joinedAt;
  final List<MishnaRef> assigned;
  final List<MishnaRef> completed;
  final List<String> groupIds;

  factory Chaluka.fromJson(Map<String, dynamic> json) => Chaluka(
        commitment: json['commitment'] as int?,
        joinedAt: json['joinedAt'] as String?,
        assigned: _refList(json['assigned']),
        completed: _refList(json['completed']),
        groupIds: (json['groupIds'] as List).cast<String>(),
      );
}

List<MishnaRef> _refList(dynamic json) => (json as List)
    .map((e) => MishnaRef.fromJson(e as Map<String, dynamic>))
    .toList();
