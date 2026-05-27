/**
 * @module database/repositories/wallet.repository
 */
'use strict';

const { queryOne, queryAll, execute } = require('../connection');
const { toMoney } = require('../../shared/fp-utils');

const toWallet = (row) => {
  if (!row) return null;
  return Object.freeze({
    id:             row.id,
    userId:         row.user_id,
    name:           row.name,
    type:           row.type,
    balance:        row.balance,
    initialBalance: row.initial_balance,
    color:          row.color,
    icon:           row.icon,
    creditLimit:    row.credit_limit,
    closingDay:     row.closing_day,
    dueDay:         row.due_day,
    linkedWalletId: row.linked_wallet_id,
    entityType:     row.entity_type,
    isArchived:     Boolean(row.is_archived),
    archivedAt:     row.archived_at,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
  });
};

const findWalletById = (id) =>
  toWallet(queryOne('SELECT * FROM wallets WHERE id = ?', [id]));

const listWallets = (userId) =>
  queryAll('SELECT * FROM wallets WHERE user_id = ? ORDER BY created_at ASC', [userId]).map(toWallet);

const saveWallet = (wallet) => {
  execute(
    `INSERT INTO wallets(id, user_id, name, type, balance, initial_balance, color, icon,
       credit_limit, closing_day, due_day, linked_wallet_id, entity_type,
       is_archived, archived_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,NULL,?,?)`,
    [
      wallet.id, wallet.userId, wallet.name, wallet.type,
      wallet.balance, wallet.initialBalance,
      wallet.color, wallet.icon,
      wallet.creditLimit || null, wallet.closingDay || null,
      wallet.dueDay || null, wallet.linkedWalletId || null,
      wallet.entityType || 'pf',
      wallet.createdAt, wallet.updatedAt,
    ]
  );
  return findWalletById(wallet.id);
};

const updateWallet = (id, updates) => {
  const fields = [], values = [];
  const map = {
    name: 'name', color: 'color', icon: 'icon',
    balance: 'balance', creditLimit: 'credit_limit',
    isArchived: 'is_archived', archivedAt: 'archived_at',
  };
  Object.entries(map).forEach(([k, col]) => {
    if (updates[k] !== undefined) {
      fields.push(`${col} = ?`);
      values.push(k === 'isArchived' ? (updates[k] ? 1 : 0) : updates[k]);
    }
  });
  fields.push('updated_at = ?');
  values.push(new Date().toISOString(), id);
  execute(`UPDATE wallets SET ${fields.join(', ')} WHERE id = ?`, values);
};

module.exports = Object.freeze({ findWalletById, listWallets, saveWallet, updateWallet });
