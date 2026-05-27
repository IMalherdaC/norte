/**
 * @module database/migrations/run
 * @description Runner de migrations — aplica todas em ordem (bootstrap-safe).
 */
'use strict';

const migration001 = require('./001_initial_schema');
const { queryOne, getDB } = require('../connection');

const MIGRATIONS = [migration001];

const runMigrations = () => {
  console.log('🔄 Verificando migrations...');

  // Garante que a tabela de controle existe antes de qualquer coisa
  getDB().exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  MIGRATIONS.forEach((m) => {
    const applied = queryOne(
      'SELECT version FROM schema_migrations WHERE version = ?',
      [m.version]
    );
    if (!applied) {
      console.log(`  ▶ Aplicando v${m.version}...`);
      m.up();
    } else {
      console.log(`  ✅ v${m.version} já aplicada.`);
    }
  });

  console.log('✅ Banco de dados atualizado.');
};

module.exports = { runMigrations };
