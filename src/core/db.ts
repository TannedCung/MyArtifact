import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const originalEmitWarning = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const msg = typeof warning === 'string' ? warning : warning?.message || '';
  if (msg.includes('SQLite is an experimental feature')) {
    return;
  }
  return (originalEmitWarning as (...a: unknown[]) => void).call(
    process,
    warning,
    ...args
  );
}) as typeof process.emitWarning;

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

export function openSqliteDatabase(dbPath: string): DatabaseSyncType {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

export function initDatabase(dbPath: string): DatabaseSyncType {
  const db = openSqliteDatabase(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT '',
      agent TEXT NOT NULL DEFAULT 'user',
      project TEXT NOT NULL DEFAULT 'default',
      category TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      links_json TEXT NOT NULL DEFAULT '[]',
      icon TEXT NOT NULL DEFAULT '',
      current_version INTEGER NOT NULL DEFAULT 1,
      file_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifact_versions (
      artifact_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      agent TEXT NOT NULL DEFAULT 'user',
      summary TEXT NOT NULL DEFAULT '',
      file_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      byte_size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (artifact_id, version),
      FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS artifact_kv_store (
      artifact_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      byte_size INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (artifact_id, key),
      FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS artifacts_fts USING fts5(
      artifact_id UNINDEXED,
      slug,
      title,
      description,
      tags,
      content
    );

    CREATE TABLE IF NOT EXISTS tb_scalars (
      artifact_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      step INTEGER NOT NULL,
      epoch REAL,
      value REAL NOT NULL,
      wall_time REAL NOT NULL,
      PRIMARY KEY (artifact_id, tag, step),
      FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tb_checkpoints (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      run_slug TEXT NOT NULL,
      name TEXT NOT NULL,
      step INTEGER NOT NULL DEFAULT 0,
      epoch REAL,
      file_path TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'pt',
      byte_size INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '',
      metrics_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      is_best INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
    );
  `);

  const cols = db.prepare('PRAGMA table_info(artifacts)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'icon')) {
    db.exec("ALTER TABLE artifacts ADD COLUMN icon TEXT NOT NULL DEFAULT '';");
  }
  if (!cols.some((c) => c.name === 'category')) {
    db.exec("ALTER TABLE artifacts ADD COLUMN category TEXT NOT NULL DEFAULT '';");
  }
  if (!cols.some((c) => c.name === 'links_json')) {
    db.exec("ALTER TABLE artifacts ADD COLUMN links_json TEXT NOT NULL DEFAULT '[]';");
  }

  return db;
}
