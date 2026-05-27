/**
 * @module database/connection
 * @description Conexão SQLite com node-sqlite3-wasm (puro WebAssembly — sem compilação nativa).
 * Funciona em Windows, Mac e Linux sem precisar de Visual Studio ou ferramentas de build.
 * ZERO classes — só funções puras e closures.
 */

'use strict';

const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const fs   = require('fs');

// ─── Caminho do banco ───
const DB_DIR  = path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DB_DIR, process.env.NODE_ENV === 'test' ? 'norte_test.db' : 'norte.db');

// Garante que o diretório existe
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

// ─── Singleton da conexão ───
let _db = null;

const getDB = () => {
  if (_db) return _db;

  _db = new Database(DB_PATH);

  // Configurações de integridade (sem WAL — node-sqlite3-wasm usa modo DELETE)
  try { _db.exec('PRAGMA foreign_keys = ON'); }  catch (_) {}
  try { _db.exec('PRAGMA synchronous = NORMAL'); } catch (_) {}
  try { _db.exec('PRAGMA cache_size = -32000'); }  catch (_) {}
  try { _db.exec('PRAGMA temp_store = MEMORY'); }  catch (_) {}

  return _db;
};

// ─── QUERY BUILDERS ───

const queryAll = (sql, params = []) => {
  return getDB().all(sql, params);
};

const queryOne = (sql, params = []) => {
  const rows = getDB().all(sql, params);
  return rows.length > 0 ? rows[0] : undefined;
};

const execute = (sql, params = []) => {
  const db = getDB();
  const result = db.run(sql, params);
  return {
    changes:         result ? result.changes         : 0,
    lastInsertRowid: result ? result.lastInsertRowid : 0,
  };
};

const withTransaction = (fn) => {
  const db = getDB();
  db.exec('BEGIN');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw e;
  }
};

const closeDB = () => {
  if (_db) { try { _db.close(); } catch (_) {} _db = null; }
};

module.exports = Object.freeze({
  getDB,
  queryAll,
  queryOne,
  execute,
  withTransaction,
  closeDB,
  DB_PATH,
});
