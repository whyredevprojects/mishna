/**
 * Central registry of TanStack Query cache keys. Keeping them in one place makes
 * invalidation (after a mutation) and dedup (across guards + components) easy to
 * reason about — a key is the cache identity of a request.
 */
export const queryKeys = {
  /** GET /api/me — session + membership + identity. */
  me: ['me'] as const,
  /** GET /api/cycle — public cycle bounds + progress. */
  cycle: ['cycle'] as const,
  /** GET /api/assignments/today — the server's notion of "today". */
  assignmentToday: ['assignment', 'today'] as const,
  /** GET /api/me/chaluka — the caller's whole-cycle portion + learned subset. */
  chaluka: ['chaluka'] as const,
  /** GET /api/assignments?date= — a specific day (keyed per date so each is cached). */
  assignment: (date: string) => ['assignment', date] as const,
  /** GET /api/admin/groups. */
  adminGroups: ['admin', 'groups'] as const,
  /** GET /api/admin/users. */
  adminUsers: ['admin', 'users'] as const,
  /** GET /api/admin/users/:id. */
  adminUser: (id: string) => ['admin', 'user', id] as const,
} as const;
