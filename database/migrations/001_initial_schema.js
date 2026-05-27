/**
 * @module database/migrations/001_initial_schema
 * @description Schema inicial do Norte.
 * Cria todas as tabelas com índices otimizados.
 * Princípios:
 *  - Campos sensíveis (CPF, CNPJ, saldo) criptografados em repouso (AES-256-GCM)
 *  - Soft-delete via deleted_at em vez de DELETE físico
 *  - LGPD: suporte a exportação e exclusão com carência de 30 dias
 */

'use strict';

const { execute, withTransaction, getDB } = require('../connection');

const UP = `
  -- ═══════════════════════════════════════════
  -- USERS
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS users (
    id                      TEXT PRIMARY KEY,
    email                   TEXT NOT NULL UNIQUE,
    password_hash           TEXT,
    name                    TEXT NOT NULL DEFAULT '',
    avatar_url              TEXT,
    role                    TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
    provider                TEXT NOT NULL DEFAULT 'email' CHECK(provider IN ('email','google')),
    google_id               TEXT UNIQUE,
    is_verified             INTEGER NOT NULL DEFAULT 0,
    is_mei                  INTEGER NOT NULL DEFAULT 0,
    cnpj_encrypted          TEXT,           -- AES-256-GCM
    two_factor_enabled      INTEGER NOT NULL DEFAULT 0,
    two_factor_secret       TEXT,           -- criptografado
    pending_2fa_secret      TEXT,
    login_attempts          INTEGER NOT NULL DEFAULT 0,
    last_failed_at          TEXT,
    privacy_mode            INTEGER NOT NULL DEFAULT 0,
    dark_mode               INTEGER NOT NULL DEFAULT 0,
    -- LGPD
    deletion_requested_at   TEXT,           -- soft delete com carência 30 dias
    deleted_at              TEXT,
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

  -- ═══════════════════════════════════════════
  -- SESSIONS (refresh token rotativo)
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS sessions (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash  TEXT NOT NULL,
    user_agent          TEXT,
    ip                  TEXT,
    is_active           INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at          TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_active  ON sessions(user_id, is_active);

  -- ═══════════════════════════════════════════
  -- PASSWORD RESET TOKENS
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hashed_token TEXT NOT NULL UNIQUE,
    expires_at   TEXT NOT NULL,
    used_at      TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- ═══════════════════════════════════════════
  -- WALLETS (Contas & Cartões)
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS wallets (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    type              TEXT NOT NULL CHECK(type IN ('checking','savings','cash','credit','investment')),
    balance           REAL NOT NULL DEFAULT 0,
    initial_balance   REAL NOT NULL DEFAULT 0,
    color             TEXT NOT NULL DEFAULT '#6366F1',
    icon              TEXT NOT NULL DEFAULT '🏦',
    -- Cartão de crédito
    credit_limit      REAL,
    closing_day       INTEGER,
    due_day           INTEGER,
    linked_wallet_id  TEXT REFERENCES wallets(id),
    -- MEI
    entity_type       TEXT NOT NULL DEFAULT 'pf' CHECK(entity_type IN ('pf','pj')),
    -- Estado
    is_archived       INTEGER NOT NULL DEFAULT 0,
    archived_at       TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_wallets_user_id    ON wallets(user_id);
  CREATE INDEX IF NOT EXISTS idx_wallets_archived   ON wallets(user_id, is_archived);

  -- ═══════════════════════════════════════════
  -- CATEGORIES (categorias personalizadas + padrão)
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS categories (
    id          TEXT PRIMARY KEY,
    user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,  -- NULL = categoria padrão
    name        TEXT NOT NULL,
    type        TEXT NOT NULL CHECK(type IN ('income','expense','transfer','pj')),
    icon        TEXT NOT NULL DEFAULT '💰',
    color       TEXT NOT NULL DEFAULT '#6B7280',
    parent_id   TEXT REFERENCES categories(id),
    is_default  INTEGER NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_categories_user_id   ON categories(user_id);
  CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id);
  CREATE INDEX IF NOT EXISTS idx_categories_defaults  ON categories(is_default);

  -- ═══════════════════════════════════════════
  -- TRANSACTIONS (lançamentos — O core)
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS transactions (
    id                    TEXT PRIMARY KEY,
    user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_id             TEXT NOT NULL REFERENCES wallets(id),
    target_wallet_id      TEXT REFERENCES wallets(id),   -- transferências
    category_id           TEXT NOT NULL REFERENCES categories(id),
    type                  TEXT NOT NULL CHECK(type IN (
                            'income','expense',
                            'transfer_in','transfer_out'
                          )),
    amount                REAL NOT NULL CHECK(amount > 0),
    description           TEXT NOT NULL DEFAULT '',
    date                  TEXT NOT NULL,                 -- YYYY-MM-DD
    -- Tags de pagamento
    tags                  TEXT NOT NULL DEFAULT '[]',    -- JSON array
    payment_method        TEXT,
    -- Recorrência
    is_recurring          INTEGER NOT NULL DEFAULT 0,
    recurring_config      TEXT,                          -- JSON
    recurring_group_id    TEXT,
    -- Parcelamento
    is_installment        INTEGER NOT NULL DEFAULT 0,
    installment_number    INTEGER,
    total_installments    INTEGER,
    installment_group_id  TEXT,
    -- Split
    is_split              INTEGER NOT NULL DEFAULT 0,
    split_group_id        TEXT,
    -- MEI
    entity_type           TEXT NOT NULL DEFAULT 'pf' CHECK(entity_type IN ('pf','pj')),
    -- Comprovante
    attachment_url        TEXT,
    -- Deduplicação (importação OFX/CSV)
    deduplication_hash    TEXT,
    import_source         TEXT CHECK(import_source IN ('ofx','csv','pdf',NULL)),
    -- Soft delete (5s de desfazer)
    deleted_at            TEXT,
    deletion_token        TEXT,
    -- Auditoria
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_tx_user_date      ON transactions(user_id, date);
  CREATE INDEX IF NOT EXISTS idx_tx_wallet         ON transactions(wallet_id);
  CREATE INDEX IF NOT EXISTS idx_tx_category       ON transactions(category_id);
  CREATE INDEX IF NOT EXISTS idx_tx_type           ON transactions(user_id, type);
  CREATE INDEX IF NOT EXISTS idx_tx_entity_type    ON transactions(user_id, entity_type);
  CREATE INDEX IF NOT EXISTS idx_tx_deleted        ON transactions(user_id, deleted_at);
  CREATE INDEX IF NOT EXISTS idx_tx_dedup_hash     ON transactions(user_id, deduplication_hash);
  CREATE INDEX IF NOT EXISTS idx_tx_recurring_grp  ON transactions(recurring_group_id);
  CREATE INDEX IF NOT EXISTS idx_tx_installment_grp ON transactions(installment_group_id);

  -- ═══════════════════════════════════════════
  -- BUDGETS (orçamentos mensais)
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS budgets (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id   TEXT NOT NULL REFERENCES categories(id),
    month         TEXT NOT NULL,              -- 'YYYY-MM'
    limit_amount  REAL NOT NULL CHECK(limit_amount > 0),
    method        TEXT NOT NULL DEFAULT 'manual' CHECK(method IN ('manual','503020')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, category_id, month)
  );

  CREATE INDEX IF NOT EXISTS idx_budgets_user_month ON budgets(user_id, month);

  -- ═══════════════════════════════════════════
  -- GOALS (metas e sonhos)
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS goals (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    target_amount   REAL NOT NULL CHECK(target_amount > 0),
    current_amount  REAL NOT NULL DEFAULT 0,
    deadline        TEXT NOT NULL,
    wallet_id       TEXT REFERENCES wallets(id),
    icon            TEXT NOT NULL DEFAULT '🎯',
    color           TEXT NOT NULL DEFAULT '#6366F1',
    is_completed    INTEGER NOT NULL DEFAULT 0,
    completed_at    TEXT,
    -- Contribuição mensal recente (para simulação PMT)
    last_monthly_contribution REAL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_goals_user_id ON goals(user_id);

  -- ═══════════════════════════════════════════
  -- INVESTMENTS (posições de investimento)
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS investments (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    ticker           TEXT,
    type             TEXT NOT NULL,   -- cdb, acoes, fii, etc.
    class            TEXT NOT NULL,   -- fixed_income, variable, pension
    invested_amount  REAL NOT NULL CHECK(invested_amount > 0),
    current_value    REAL NOT NULL,
    quantity         REAL,
    purchase_date    TEXT NOT NULL,
    maturity_date    TEXT,
    rate             TEXT,
    institution      TEXT NOT NULL DEFAULT '',
    entity_type      TEXT NOT NULL DEFAULT 'pf' CHECK(entity_type IN ('pf','pj')),
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_investments_user_id ON investments(user_id);
  CREATE INDEX IF NOT EXISTS idx_investments_class   ON investments(user_id, class);

  -- ═══════════════════════════════════════════
  -- SHARING (compartilhamento entre usuários — casais)
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS shared_access (
    id              TEXT PRIMARY KEY,
    owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guest_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Categorias compartilhadas (JSON array de category_ids, NULL = todas)
    shared_categories TEXT,
    can_write       INTEGER NOT NULL DEFAULT 0,
    accepted_at     TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(owner_id, guest_id)
  );

  -- ═══════════════════════════════════════════
  -- AUDIT LOG (rastreabilidade LGPD)
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS audit_log (
    id          TEXT PRIMARY KEY,
    user_id     TEXT REFERENCES users(id),
    action      TEXT NOT NULL,    -- 'login', 'export_data', 'delete_account', etc.
    entity_type TEXT,
    entity_id   TEXT,
    ip          TEXT,
    user_agent  TEXT,
    metadata    TEXT,             -- JSON extra
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_audit_user_id   ON audit_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_action    ON audit_log(action);
  CREATE INDEX IF NOT EXISTS idx_audit_created   ON audit_log(created_at);

  -- ═══════════════════════════════════════════
  -- SCHEMA VERSION
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

const DOWN = `
  DROP TABLE IF EXISTS audit_log;
  DROP TABLE IF EXISTS shared_access;
  DROP TABLE IF EXISTS investments;
  DROP TABLE IF EXISTS goals;
  DROP TABLE IF EXISTS budgets;
  DROP TABLE IF EXISTS transactions;
  DROP TABLE IF EXISTS categories;
  DROP TABLE IF EXISTS wallets;
  DROP TABLE IF EXISTS password_reset_tokens;
  DROP TABLE IF EXISTS sessions;
  DROP TABLE IF EXISTS users;
  DROP TABLE IF EXISTS schema_migrations;
`;

/**
 * Aplica a migration (idempotente — CREATE IF NOT EXISTS).
 */
const up = () => {
  const db = getDB();
  db.exec(UP);
  execute(
    'INSERT OR IGNORE INTO schema_migrations(version, name) VALUES (?, ?)',
    [1, '001_initial_schema']
  );
  console.log('✅ Migration 001_initial_schema aplicada.');
};

/**
 * Reverte a migration (CUIDADO — apaga todos os dados).
 */
const down = () => {
  const db = getDB();
  db.exec(DOWN);
  console.log('⚠️  Migration 001_initial_schema revertida.');
};

module.exports = Object.freeze({ up, down, version: 1 });
