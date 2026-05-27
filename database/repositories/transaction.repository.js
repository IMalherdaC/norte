/**
 * @module database/repositories/transaction.repository
 * @description Repositório de transações — implementa todas as deps do transaction.service.
 * Queries otimizadas com índices + transações ACID via withTransaction.
 */
'use strict';

const { queryOne, queryAll, execute, withTransaction } = require('../connection');
const { toMoney } = require('../../shared/fp-utils');

// ─── Mapper ───
const toTx = (row) => {
  if (!row) return null;
  return Object.freeze({
    id:                  row.id,
    userId:              row.user_id,
    walletId:            row.wallet_id,
    targetWalletId:      row.target_wallet_id,
    categoryId:          row.category_id,
    type:                row.type,
    amount:              row.amount,
    description:         row.description,
    date:                row.date,
    tags:                JSON.parse(row.tags || '[]'),
    paymentMethod:       row.payment_method,
    isRecurring:         Boolean(row.is_recurring),
    recurringConfig:     row.recurring_config ? JSON.parse(row.recurring_config) : null,
    recurringGroupId:    row.recurring_group_id,
    isInstallment:       Boolean(row.is_installment),
    installmentNumber:   row.installment_number,
    totalInstallments:   row.total_installments,
    installmentGroupId:  row.installment_group_id,
    isSplit:             Boolean(row.is_split),
    splitGroupId:        row.split_group_id,
    entityType:          row.entity_type,
    attachmentUrl:       row.attachment_url,
    deduplicationHash:   row.deduplication_hash,
    importSource:        row.import_source,
    deletedAt:           row.deleted_at,
    deletionToken:       row.deletion_token,
    createdAt:           row.created_at,
    updatedAt:           row.updated_at,
    // Joins (quando disponíveis)
    categoryName:        row.category_name,
    categoryIcon:        row.category_icon,
    categoryColor:       row.category_color,
    walletName:          row.wallet_name,
  });
};

// ─── QUERIES ───

const findTransaction = (id, opts = {}) => {
  const sql = opts.includeDeleted
    ? 'SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color, w.name AS wallet_name FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN wallets w ON w.id = t.wallet_id WHERE t.id = ?'
    : 'SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color, w.name AS wallet_name FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN wallets w ON w.id = t.wallet_id WHERE t.id = ? AND t.deleted_at IS NULL';
  return toTx(queryOne(sql, [id]));
};

const queryTransactions = (filters) => {
  const conditions = ['t.user_id = ?', 't.deleted_at IS NULL'];
  const params     = [filters.userId];

  if (filters.walletId)    { conditions.push('t.wallet_id = ?');   params.push(filters.walletId); }
  if (filters.categoryId)  { conditions.push('t.category_id = ?'); params.push(filters.categoryId); }
  if (filters.type)        { conditions.push('t.type = ?');        params.push(filters.type); }
  if (filters.startDate)   { conditions.push('t.date >= ?');       params.push(filters.startDate); }
  if (filters.endDate)     { conditions.push('t.date <= ?');       params.push(filters.endDate); }
  if (filters.entityType && filters.entityType !== 'all') {
    conditions.push('t.entity_type = ?');
    params.push(filters.entityType);
  }
  if (filters.search) {
    conditions.push('t.description LIKE ?');
    params.push(`%${filters.search}%`);
  }
  if (filters.minAmount !== undefined) { conditions.push('t.amount >= ?'); params.push(filters.minAmount); }
  if (filters.maxAmount !== undefined) { conditions.push('t.amount <= ?'); params.push(filters.maxAmount); }

  const where  = conditions.join(' AND ');
  const total  = queryOne(`SELECT COUNT(*) AS n FROM transactions t WHERE ${where}`, params).n;
  const items  = queryAll(
    `SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
            w.name AS wallet_name
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN wallets    w ON w.id = t.wallet_id
     WHERE ${where}
     ORDER BY t.date DESC, t.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, filters.limit || 50, filters.skip || 0]
  );

  return { items: items.map(toTx), total };
};

const findHashesByUserId = (userId) => {
  const rows = queryAll(
    'SELECT deduplication_hash FROM transactions WHERE user_id = ? AND deduplication_hash IS NOT NULL AND deleted_at IS NULL',
    [userId]
  );
  return rows.map((r) => r.deduplication_hash);
};

// ─── COMMANDS ACID ───

/**
 * Salva uma transação E atualiza o saldo da carteira em uma única transação ACID.
 */
const saveTransactionWithBalanceUpdate = (tx, walletId, balanceDelta) => {
  withTransaction(() => {
    execute(
      `INSERT INTO transactions(
         id, user_id, wallet_id, target_wallet_id, category_id, type, amount,
         description, date, tags, payment_method,
         is_recurring, recurring_config, recurring_group_id,
         is_installment, installment_number, total_installments, installment_group_id,
         is_split, split_group_id, entity_type, attachment_url,
         deduplication_hash, import_source,
         deleted_at, deletion_token, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)`,
      [
        tx.id, tx.userId, tx.walletId, tx.targetWalletId || null,
        tx.categoryId, tx.type, tx.amount, tx.description, tx.date,
        JSON.stringify(tx.tags || []), tx.paymentMethod || null,
        tx.isRecurring ? 1 : 0,
        tx.recurringConfig ? JSON.stringify(tx.recurringConfig) : null,
        tx.recurringGroupId || null,
        tx.isInstallment ? 1 : 0,
        tx.installmentNumber || null, tx.totalInstallments || null,
        tx.installmentGroupId || null,
        tx.isSplit ? 1 : 0, tx.splitGroupId || null,
        tx.entityType || 'pf', tx.attachmentUrl || null,
        tx.deduplicationHash || null, tx.importSource || null,
        tx.createdAt, tx.updatedAt,
      ]
    );

    // Atualiza saldo ACID
    execute(
      'UPDATE wallets SET balance = balance + ?, updated_at = ? WHERE id = ?',
      [toMoney(balanceDelta), new Date().toISOString(), walletId]
    );
  });
};

/**
 * Salva par de transferências (débito + crédito) e atualiza dois saldos — ACID.
 */
const saveTransferPair = (outTx, inTx, fromWalletId, toWalletId, amount) => {
  withTransaction(() => {
    const insertSQL = `INSERT INTO transactions(
      id, user_id, wallet_id, target_wallet_id, category_id, type, amount,
      description, date, tags, payment_method, is_recurring, recurring_config,
      recurring_group_id, is_installment, installment_number, total_installments,
      installment_group_id, is_split, split_group_id, entity_type, attachment_url,
      deduplication_hash, import_source, deleted_at, deletion_token, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)`;

    const toParams = (tx) => [
      tx.id, tx.userId, tx.walletId, tx.targetWalletId || null,
      tx.categoryId, tx.type, tx.amount, tx.description, tx.date,
      JSON.stringify(tx.tags || []), tx.paymentMethod || null,
      0, null, tx.recurringGroupId || null, 0, null, null, null,
      0, null, tx.entityType || 'pf', null, tx.deduplicationHash || null, null,
      tx.createdAt, tx.updatedAt,
    ];

    execute(insertSQL, toParams(outTx));
    execute(insertSQL, toParams(inTx));

    // Débita da origem
    execute(
      'UPDATE wallets SET balance = balance - ?, updated_at = ? WHERE id = ?',
      [toMoney(amount), new Date().toISOString(), fromWalletId]
    );
    // Credita no destino
    execute(
      'UPDATE wallets SET balance = balance + ?, updated_at = ? WHERE id = ?',
      [toMoney(amount), new Date().toISOString(), toWalletId]
    );
  });
};

/**
 * Salva lote de transações sem alterar saldo (parcelamentos, recorrências).
 */
const saveBatchTransactions = (transactions, walletId, type, amount) => {
  withTransaction(() => {
    transactions.forEach((tx) => {
      execute(
        `INSERT OR IGNORE INTO transactions(
           id, user_id, wallet_id, target_wallet_id, category_id, type, amount,
           description, date, tags, payment_method,
           is_recurring, recurring_config, recurring_group_id,
           is_installment, installment_number, total_installments, installment_group_id,
           is_split, split_group_id, entity_type, attachment_url,
           deduplication_hash, import_source, deleted_at, deletion_token, created_at, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)`,
        [
          tx.id, tx.userId, tx.walletId, tx.targetWalletId || null,
          tx.categoryId, tx.type, tx.amount, tx.description, tx.date,
          JSON.stringify(tx.tags || []), tx.paymentMethod || null,
          tx.isRecurring ? 1 : 0,
          tx.recurringConfig ? JSON.stringify(tx.recurringConfig) : null,
          tx.recurringGroupId || null,
          tx.isInstallment ? 1 : 0,
          tx.installmentNumber || null, tx.totalInstallments || null,
          tx.installmentGroupId || null,
          tx.isSplit ? 1 : 0, tx.splitGroupId || null,
          tx.entityType || 'pf', tx.attachmentUrl || null,
          tx.deduplicationHash || null, tx.importSource || null,
          tx.createdAt, tx.updatedAt,
        ]
      );
    });
  });
};

const softDeleteTransaction = (id, updates) => {
  execute(
    'UPDATE transactions SET deleted_at = ?, deletion_token = ?, updated_at = ? WHERE id = ?',
    [updates.deletedAt, updates.deletionToken, new Date().toISOString(), id]
  );
};

const restoreTransaction = (id) => {
  execute(
    'UPDATE transactions SET deleted_at = NULL, deletion_token = NULL, updated_at = ? WHERE id = ?',
    [new Date().toISOString(), id]
  );
};

const replaceSplitTransaction = (originalId, splitTxs) => {
  withTransaction(() => {
    // Soft-delete o original
    execute(
      'UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ?',
      [new Date().toISOString(), new Date().toISOString(), originalId]
    );
    // Insere os splits (sem alterar saldo — só redistribui categorias)
    splitTxs.forEach((tx) => {
      execute(
        `INSERT INTO transactions(
           id, user_id, wallet_id, target_wallet_id, category_id, type, amount,
           description, date, tags, payment_method, is_recurring, recurring_config,
           recurring_group_id, is_installment, installment_number, total_installments,
           installment_group_id, is_split, split_group_id, entity_type, attachment_url,
           deduplication_hash, import_source, deleted_at, deletion_token, created_at, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)`,
        [
          tx.id, tx.userId, tx.walletId, null, tx.categoryId, tx.type, tx.amount,
          tx.description, tx.date, JSON.stringify(tx.tags || []), null,
          0, null, null, 0, null, null, null,
          1, tx.splitGroupId, tx.entityType || 'pf', null,
          tx.deduplicationHash || null, null,
          tx.createdAt, tx.updatedAt,
        ]
      );
    });
  });
};

// ─── ANALYTICS HELPERS ───

const getTransactionsByPeriod = (userId, startDate, endDate, entityType = 'all') => {
  const sql = entityType === 'all'
    ? `SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.user_id = ? AND t.date BETWEEN ? AND ? AND t.deleted_at IS NULL
       ORDER BY t.date DESC`
    : `SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.user_id = ? AND t.date BETWEEN ? AND ? AND t.entity_type = ? AND t.deleted_at IS NULL
       ORDER BY t.date DESC`;
  const params = entityType === 'all'
    ? [userId, startDate, endDate]
    : [userId, startDate, endDate, entityType];
  return queryAll(sql, params).map(toTx);
};

const getSpentByCategory = (userId, month) => {
  const rows = queryAll(
    `SELECT category_id, SUM(amount) AS total
     FROM transactions
     WHERE user_id = ? AND type = 'expense'
       AND date LIKE ? AND deleted_at IS NULL
     GROUP BY category_id`,
    [userId, `${month}%`]
  );
  return rows.reduce((acc, r) => ({ ...acc, [r.category_id]: r.total }), {});
};

const getDailySpending = (userId, month) => {
  const rows = queryAll(
    `SELECT date, SUM(amount) AS amount
     FROM transactions
     WHERE user_id = ? AND type = 'expense'
       AND date LIKE ? AND deleted_at IS NULL
     GROUP BY date ORDER BY date`,
    [userId, `${month}%`]
  );
  return rows.map((r) => ({ day: parseInt(r.date.split('-')[2]), date: r.date, amount: r.amount }));
};

const getHistoricalSpending = (userId, currentMonth, lookbackMonths) => {
  const months = [];
  const [y, m] = currentMonth.split('-').map(Number);
  for (let i = lookbackMonths; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const rows = queryAll(
    `SELECT substr(date, 1, 7) AS month, category_id, SUM(amount) AS amount
     FROM transactions
     WHERE user_id = ? AND type = 'expense' AND deleted_at IS NULL
       AND substr(date,1,7) IN (${months.map(() => '?').join(',')})
     GROUP BY month, category_id`,
    [userId, ...months]
  );
  return rows;
};

const getMonthlyBalanceHistory = (userId, months) => {
  // Retorna snapshot mensal (simplificado — saldo acumulado por mês)
  const rows = queryAll(
    `SELECT substr(date,1,7) AS month,
            SUM(CASE WHEN type='income' THEN amount ELSE 0 END) AS income,
            SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) AS expenses
     FROM transactions
     WHERE user_id = ? AND deleted_at IS NULL
     GROUP BY month ORDER BY month DESC LIMIT ?`,
    [userId, months]
  );
  let cumulative = 0;
  return rows.reverse().map((r) => {
    cumulative += (r.income - r.expenses);
    return Object.freeze({
      month:       r.month,
      totalIncome: r.income,
      totalExpenses: r.expenses,
      netWorth:    toMoney(cumulative),
      totalAssets: toMoney(cumulative > 0 ? cumulative : 0),
      totalLiabilities: toMoney(cumulative < 0 ? Math.abs(cumulative) : 0),
    });
  });
};

module.exports = Object.freeze({
  findTransaction,
  queryTransactions,
  findHashesByUserId,
  saveTransactionWithBalanceUpdate,
  saveTransferPair,
  saveBatchTransactions,
  softDeleteTransaction,
  restoreTransaction,
  replaceSplitTransaction,
  getTransactionsByPeriod,
  getSpentByCategory,
  getDailySpending,
  getHistoricalSpending,
  getMonthlyBalanceHistory,
});
