import Database from "better-sqlite3";
import path from "node:path";
import { DATA_DIR } from "./paths";

declare global {
  // eslint-disable-next-line no-var
  var __profeciaDb: Database.Database | undefined;
}

function open() {
  const db = new Database(path.join(DATA_DIR, "profecia.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'borrador',
      input_text TEXT NOT NULL DEFAULT '',
      input_kind TEXT NOT NULL DEFAULT 'articulo',
      source_lang TEXT,
      script TEXT NOT NULL DEFAULT '',
      script_meta TEXT,
      settings TEXT NOT NULL,
      seo TEXT,
      thumbnails TEXT,
      output_path TEXT,
      srt_path TEXT,
      srt_en_path TEXT,
      narration_path TEXT,
      custom_narration INTEGER NOT NULL DEFAULT 0,
      authorized_cost REAL NOT NULL DEFAULT 0,
      spent_cost REAL NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS scenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      text TEXT NOT NULL,
      start REAL NOT NULL DEFAULT 0,
      end REAL NOT NULL DEFAULT 0,
      query TEXT,
      overlay TEXT,
      keywords TEXT,
      queries TEXT,
      asset_id INTEGER,
      locked INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS scenes_project ON scenes(project_id, idx);
    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      kind TEXT NOT NULL,
      external_id TEXT,
      source_url TEXT,
      page_url TEXT,
      author TEXT,
      license TEXT,
      attribution TEXT,
      local_path TEXT NOT NULL,
      is_ai INTEGER NOT NULL DEFAULT 0,
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'en_cola',
      progress REAL NOT NULL DEFAULT 0,
      step TEXT,
      log TEXT NOT NULL DEFAULT '',
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cost_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT,
      provider TEXT NOT NULL,
      units REAL NOT NULL,
      unit TEXT NOT NULL,
      cost REAL NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Migraciones para bases de datos creadas con versiones anteriores (no se pierde nada).
  const cols = (db.prepare("PRAGMA table_info(scenes)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("queries")) db.exec("ALTER TABLE scenes ADD COLUMN queries TEXT");
  const pcols = (db.prepare("PRAGMA table_info(projects)").all() as { name: string }[]).map((c) => c.name);
  if (!pcols.includes("ai_plan")) db.exec("ALTER TABLE projects ADD COLUMN ai_plan TEXT");
  return db;
}

export function db() {
  if (!globalThis.__profeciaDb) globalThis.__profeciaDb = open();
  return globalThis.__profeciaDb;
}
