/**
 * 账号、会话、积分与检测记录的存储层。
 *
 * 用 Node 22 内置的 node:sqlite（零依赖），数据库文件放在共享盘，避免占根分区。
 * 表结构刻意保持最小：users / sessions / credit_ledger / detections。
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_DIR = process.env.VERITAS_DATA_DIR || path.join(process.cwd(), 'tmp', 'data');

let db = null;

function isDbAlive(instance) {
  if (!instance) return false;
  if (typeof instance.isOpen === 'boolean') return instance.isOpen;
  try {
    instance.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

function ensureColumn(instance, table, column, definition) {
  const cols = instance.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(col => col.name === column)) {
    instance.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function openDatabase(file) {
  if (isDbAlive(db)) return db;
  const target = file || path.join(process.env.VERITAS_DATA_DIR || DEFAULT_DIR, 'app.db');
  mkdirSync(path.dirname(target), { recursive: true });
  db = new DatabaseSync(target);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      credits INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      sid_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS credit_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref_id TEXT,
      balance_after INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      scene TEXT,
      summary TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS detections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      scene TEXT NOT NULL,
      path TEXT,
      status TEXT NOT NULL,
      summary TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_user ON credit_ledger(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_detections_user ON detections(user_id, created_at DESC);
  `);
  ensureColumn(db, 'credit_ledger', 'scene', 'TEXT');
  ensureColumn(db, 'credit_ledger', 'summary', 'TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_user_ref ON credit_ledger(user_id, ref_id) WHERE ref_id IS NOT NULL');
  return db;
}

export function getDatabase() {
  return isDbAlive(db) ? db : openDatabase();
}
