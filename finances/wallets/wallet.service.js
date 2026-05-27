/**
 * @module finances/wallets/wallet.service
 * @description Serviço de Contas e Cartões.
 *
 * Funcionalidades:
 *   - Contas correntes, poupança, carteira cash, investimento
 *   - Cartões de crédito (limite, fechamento, vencimento)
 *   - Saldo consolidado em tempo real
 *   - Arquivamento (preserva histórico)
 *
 * PARADIGMA: 100% Funcional. ZERO classes.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const { Ok, Err, isOk, deepFreeze, toMoney, sumValues, update } = require('../../shared/fp-utils');
const { validateWallet } = require('../../shared/validators');
const { emitEvent, EVENTS } = require('../../core/events/event-bus');

// ─────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────

const createWalletRecord = (data) =>
  deepFreeze({
    id:             uuidv4(),
    userId:         data.userId,
    name:           data.name,
    type:           data.type,           // checking | savings | cash | credit | investment
    balance:        toMoney(Number(data.initialBalance || 0)),
    initialBalance: toMoney(Number(data.initialBalance || 0)),
    color:          data.color || '#6366F1',
    icon:           data.icon  || '🏦',
    // Cartão de crédito
    creditLimit:    data.creditLimit    || null,
    closingDay:     data.closingDay     || null,   // dia de fechamento
    dueDay:         data.dueDay         || null,   // dia de vencimento
    linkedWalletId: data.linkedWalletId || null,   // conta para débito automático
    // MEI
    entityType:     data.entityType || 'pf',       // 'pf' | 'pj'
    // Estado
    isArchived:     false,
    archivedAt:     null,
    createdAt:      new Date().toISOString(),
    updatedAt:      new Date().toISOString(),
  });

// ─────────────────────────────────────────────
// COMMANDS
// ─────────────────────────────────────────────

const createWallet = async (input, deps) => {
  const validated = validateWallet(input);
  if (!isOk(validated)) return validated;
  const wallet = createWalletRecord(validated.value);
  await deps.saveWallet(wallet);
  return Ok(wallet);
};

const updateWallet = async (walletId, updates, deps) => {
  const wallet = await deps.findWalletById(walletId);
  if (!wallet) return Err('Conta não encontrada');
  const updated = update(wallet, { ...updates, updatedAt: new Date().toISOString() });
  await deps.updateWallet(walletId, updated);
  emitEvent(EVENTS.WALLET_UPDATED, { walletId, userId: wallet.userId });
  return Ok(updated);
};

const archiveWallet = async (walletId, userId, deps) => {
  const wallet = await deps.findWalletById(walletId);
  if (!wallet) return Err('Conta não encontrada');
  if (wallet.userId !== userId) return Err('Acesso negado');
  const archived = update(wallet, { isArchived: true, archivedAt: new Date().toISOString() });
  await deps.updateWallet(walletId, archived);
  return Ok({ message: 'Conta arquivada. O histórico foi preservado.' });
};

// ─────────────────────────────────────────────
// QUERIES
// ─────────────────────────────────────────────

const listWallets = async (userId, deps) => {
  const wallets = await deps.listWallets(userId);
  return Ok(Object.freeze(wallets));
};

const getConsolidatedBalance = async (userId, deps) => {
  const wallets = await deps.listWallets(userId);
  const active  = wallets.filter((w) => !w.isArchived && w.type !== 'credit');
  const total   = sumValues(active.map((w) => w.balance));
  const byType  = active.reduce((acc, w) => ({
    ...acc,
    [w.type]: toMoney((acc[w.type] || 0) + w.balance),
  }), {});

  return Ok(deepFreeze({ total, byType, wallets: active }));
};

module.exports = Object.freeze({
  createWallet,
  updateWallet,
  archiveWallet,
  listWallets,
  getConsolidatedBalance,
  createWalletRecord,
});
