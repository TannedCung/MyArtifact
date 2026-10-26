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

export function initDatabase(dbPath: string): DatabaseSyncType {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

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
      tags_json TEXT NOT NULL DEFAULT '[]',
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
  `);

  return db;
}
