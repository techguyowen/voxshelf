import { DB_PATH, ensureDirs } from "./paths";

// Server-only SQLite access. Prefers better-sqlite3 and falls back to the
// built-in node:sqlite module when the native binding is unavailable.

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface DbStatement {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

export interface DbHandle {
  prepare(sql: string): DbStatement;
  exec(sql: string): void;
}

// Indirect require keeps the optional native binding out of the bundler graph.
function tryRequire(name: string): unknown {
  try {
    const req = eval("require") as (n: string) => unknown;
    return req(name);
  } catch {
    return null;
  }
}

function openBetterSqlite3(): DbHandle | null {
  try {
    const Database = tryRequire("better-sqlite3") as (new (
      path: string,
    ) => {
      pragma(s: string): void;
      prepare(sql: string): {
        run(...p: unknown[]): { changes: unknown; lastInsertRowid: unknown };
        get(...p: unknown[]): Record<string, unknown> | undefined;
        all(...p: unknown[]): Record<string, unknown>[];
      };
      exec(sql: string): void;
    }) | null;
    if (!Database) return null;
    const db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    return {
      prepare: (sql: string) => {
        const st = db.prepare(sql);
        return {
          run: (...p: unknown[]) => {
            const r = st.run(...p);
            return {
              changes: Number(r.changes ?? 0),
              lastInsertRowid: Number(r.lastInsertRowid ?? 0),
            };
          },
          get: (...p: unknown[]) => st.get(...p),
          all: (...p: unknown[]) => st.all(...p),
        };
      },
      exec: (sql: string) => db.exec(sql),
    };
  } catch {
    return null;
  }
}

function openNodeSqlite(): DbHandle | null {
  try {
    const mod = tryRequire("node:sqlite") as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void;
        prepare(sql: string): {
          run(...p: unknown[]): { changes: unknown; lastInsertRowid: unknown };
          get(...p: unknown[]): Record<string, unknown> | undefined | null;
          all(...p: unknown[]): Record<string, unknown>[];
        };
      };
    } | null;
    if (!mod?.DatabaseSync) return null;
    const db = new mod.DatabaseSync(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    return {
      prepare: (sql: string) => {
        const st = db.prepare(sql);
        return {
          run: (...p: unknown[]) => {
            const r = st.run(...p);
            return {
              changes: Number(r.changes ?? 0),
              lastInsertRowid: Number(r.lastInsertRowid ?? 0),
            };
          },
          get: (...p: unknown[]) => st.get(...p) ?? undefined,
          all: (...p: unknown[]) => st.all(...p),
        };
      },
      exec: (sql: string) => db.exec(sql),
    };
  } catch {
    return null;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  source_type TEXT NOT NULL DEFAULT 'paste',
  source_url TEXT,
  full_text TEXT NOT NULL DEFAULT '',
  total_chars INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0,
  sentence_count INTEGER NOT NULL DEFAULT 0,
  voice TEXT NOT NULL DEFAULT 'Kore',
  style_prompt TEXT,
  speed REAL NOT NULL DEFAULT 1,
  tags TEXT NOT NULL DEFAULT '[]',
  progress_sentence_index INTEGER NOT NULL DEFAULT 0,
  progress_char_offset INTEGER NOT NULL DEFAULT 0,
  progress_updated_at TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sentences (
  doc_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  char_start INTEGER NOT NULL DEFAULT 0,
  char_end INTEGER NOT NULL DEFAULT 0,
  audio_hash TEXT,
  audio_duration_ms INTEGER,
  PRIMARY KEY (doc_id, idx),
  FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS audio_cache (
  hash TEXT PRIMARY KEY,
  voice TEXT NOT NULL,
  style_prompt TEXT NOT NULL DEFAULT '',
  text_preview TEXT NOT NULL DEFAULT '',
  chars INTEGER NOT NULL DEFAULT 0,
  file_path TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  sentence_idx INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS highlights (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  sentence_idx INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'yellow',
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS podcasts (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  title TEXT NOT NULL,
  script TEXT NOT NULL DEFAULT '[]',
  audio_hash TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS _schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sentences_doc ON sentences(doc_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_doc ON bookmarks(doc_id);
CREATE INDEX IF NOT EXISTS idx_highlights_doc ON highlights(doc_id);
CREATE INDEX IF NOT EXISTS idx_podcasts_doc ON podcasts(doc_id);
CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents(updated_at);
`;

export function addColumnIfNotExists(
  db: DbHandle,
  table: string,
  column: string,
  definition: string,
): boolean {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
      return true;
    }
  } catch {
    // Non-fatal fallback
  }
  return false;
}

interface Migration {
  version: number;
  name: string;
  up: (db: DbHandle) => void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    up: (db) => {
      db.exec(SCHEMA);
    },
  },
  {
    version: 2,
    name: "add_folder_id_to_documents",
    up: (db) => {
      addColumnIfNotExists(db, "documents", "folder_id", "TEXT");
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_id);",
      );
    },
  },
  {
    version: 3,
    name: "add_extensible_metadata_json_columns",
    up: (db) => {
      // Extensible JSON metadata column on all core entities for future-proof feature expansion
      addColumnIfNotExists(
        db,
        "documents",
        "metadata",
        "TEXT NOT NULL DEFAULT '{}'",
      );
      addColumnIfNotExists(
        db,
        "sentences",
        "metadata",
        "TEXT NOT NULL DEFAULT '{}'",
      );
      addColumnIfNotExists(
        db,
        "highlights",
        "metadata",
        "TEXT NOT NULL DEFAULT '{}'",
      );
      addColumnIfNotExists(
        db,
        "folders",
        "metadata",
        "TEXT NOT NULL DEFAULT '{}'",
      );
      addColumnIfNotExists(
        db,
        "podcasts",
        "metadata",
        "TEXT NOT NULL DEFAULT '{}'",
      );
    },
  },
  {
    version: 4,
    name: "add_pronunciation_dictionary_table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pronunciation_dictionary (
          id TEXT PRIMARY KEY,
          word TEXT NOT NULL UNIQUE,
          replacement TEXT NOT NULL,
          case_sensitive INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pronunciation_word ON pronunciation_dictionary(word);
      `);
    },
  },
  {
    version: 5,
    name: "add_reading_sessions_and_stats_table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS reading_sessions (
          id TEXT PRIMARY KEY,
          doc_id TEXT NOT NULL,
          duration_seconds INTEGER NOT NULL DEFAULT 0,
          words_read INTEGER NOT NULL DEFAULT 0,
          speed REAL NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          FOREIGN KEY(doc_id) REFERENCES documents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_doc ON reading_sessions(doc_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_date ON reading_sessions(created_at);
      `);
    },
  },
];

function runMigrations(db: DbHandle): void {
  db.exec(SCHEMA);

  const appliedRows = db
    .prepare("SELECT version FROM _schema_migrations")
    .all() as { version: number }[];
  const appliedSet = new Set(appliedRows.map((r) => r.version));

  for (const m of MIGRATIONS) {
    if (!appliedSet.has(m.version)) {
      try {
        m.up(db);
        const now = new Date().toISOString();
        db.prepare(
          "INSERT INTO _schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        ).run(m.version, m.name, now);
      } catch (err) {
        console.error(`Migration ${m.version} (${m.name}) failed:`, err);
      }
    }
  }

  const latest = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 1;
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES ('schema_version', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(String(latest), now);
}

let handle: DbHandle | null = null;
let engine = "none";

export function dbEngine(): string {
  return engine;
}

export function getDb(): DbHandle {
  if (!handle) {
    ensureDirs();
    handle = openBetterSqlite3();
    engine = handle ? "better-sqlite3" : "none";
    if (!handle) {
      handle = openNodeSqlite();
      engine = handle ? "node:sqlite" : "none";
    }
    if (!handle) {
      throw new Error(
        "No SQLite driver available (better-sqlite3 and node:sqlite both failed to load).",
      );
    }
    runMigrations(handle);
  }
  return handle;
}

export function dbGet<T>(sql: string, ...params: unknown[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

export function dbAll<T>(sql: string, ...params: unknown[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

export function dbRun(sql: string, ...params: unknown[]): RunResult {
  return getDb().prepare(sql).run(...params);
}
