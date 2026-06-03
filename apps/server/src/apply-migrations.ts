// Test support: load every D1 migration and apply it to a binding. These are the
// same files `wrangler d1 migrations apply` runs, eager-loaded as raw SQL, so the
// test database never drifts from the real schema. Not part of the worker bundle
// (only the tests import it).
const migrations = import.meta.glob('../migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export async function applyMigrations(db: D1Database): Promise<void> {
  const sql = Object.keys(migrations)
    .sort()
    .map((path) => migrations[path])
    .join('\n')
    .replace(/--[^\n]*/g, '');
  for (const stmt of sql.split(';')) {
    const single = stmt.trim().replace(/\s+/g, ' ');
    if (single) {
      await db.exec(single);
    }
  }
}
