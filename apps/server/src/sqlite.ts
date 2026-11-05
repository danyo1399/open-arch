/**
 * The share server's records in SQLite, with Node's built-in node:sqlite (Node.js 22.13 or
 * later), through the same interface as Cloudflare's D1 (sql.ts). The schema is applied from
 * migrations/, the files wrangler applies to D1, so both keep the same tables. The executable
 * carries copies of them inside it (scripts/executable.mjs).
 */
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { SqlDatabase, SqlStatement } from "./sql.js";

/** One file from migrations/: its name, which orders it, and its SQL. */
export interface Migration {
  name: string;
  sql: string;
}

/** The files in a migrations folder: by default the one beside dist/ and src/. */
export function readMigrations(folder: URL = new URL("../migrations/", import.meta.url)): Migration[] {
  return readdirSync(folder)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(new URL(name, folder), "utf8") }));
}

type Value = null | number | bigint | string | Uint8Array;

/** A D1-shaped database over a SQLite one. Statements run as they're asked for, and a batch in one transaction. */
export function sqlDatabase(sqlite: DatabaseSync): SqlDatabase {
  const statement = (sql: string, values: Value[] = []): SqlStatement & { exec(): unknown } => ({
    bind: (...next) => statement(sql, next.map((v) => (v === undefined ? null : v)) as Value[]),
    first: async <T,>() => (sqlite.prepare(sql).get(...values) as T | undefined) ?? null,
    all: async <T,>() => ({ results: sqlite.prepare(sql).all(...values) as T[] }),
    run: async () => sqlite.prepare(sql).run(...values),
    exec: () => sqlite.prepare(sql).run(...values),
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((s) => (s as ReturnType<typeof statement>).exec());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

/** Applies the migrations a database doesn't have yet, in order. Returns their names. */
export function migrate(sqlite: DatabaseSync, migrations: Migration[] = readMigrations()): string[] {
  sqlite.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const applied = new Set((sqlite.prepare("SELECT name FROM schema_migrations").all() as { name: string }[]).map((r) => r.name));
  const pending = migrations.filter((m) => !applied.has(m.name)).sort((a, b) => a.name.localeCompare(b.name));
  for (const { name, sql } of pending) {
    sqlite.exec("BEGIN");
    try {
      sqlite.exec(sql);
      sqlite.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(name, Date.now());
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw new Error(`Couldn't apply the migration ${name}: ${(error as Error).message}`);
    }
  }
  return pending.map((m) => m.name);
}

/**
 * Opens (or creates) the database at `path`, ":memory:" for one in memory, and brings its schema
 * up to date. Write-ahead logging lets the admin commands read and change it while the server runs.
 */
export function openDatabase(path: string, migrations?: Migration[]): { sqlite: DatabaseSync; db: SqlDatabase } {
  const sqlite = new DatabaseSync(path);
  if (path !== ":memory:") sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA busy_timeout = 5000");
  migrate(sqlite, migrations);
  return { sqlite, db: sqlDatabase(sqlite) };
}
