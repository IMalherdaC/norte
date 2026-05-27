/**
 * @module server/routes/transactions.routes
 * @description Rotas de lançamentos financeiros.
 */
'use strict';

const express = require('express');
const router  = express.Router();

const txService  = require('../../finances/transactions/transaction.service');
const txRepo     = require('../../database/repositories/transaction.repository');
const walletRepo = require('../../database/repositories/wallet.repository');
const { requireAuth } = require('../middleware/auth.middleware');

// Deps injetadas
const txDeps = Object.freeze({
  findTransaction:               txRepo.findTransaction,
  findWalletById:                walletRepo.findWalletById,
  saveTransactionWithBalanceUpdate: txRepo.saveTransactionWithBalanceUpdate,
  saveTransferPair:              txRepo.saveTransferPair,
  saveBatchTransactions:         txRepo.saveBatchTransactions,
  softDeleteTransaction:         txRepo.softDeleteTransaction,
  restoreTransaction:            txRepo.restoreTransaction,
  replaceSplitTransaction:       txRepo.replaceSplitTransaction,
  findHashesByUserId:            txRepo.findHashesByUserId,
  queryTransactions:             txRepo.queryTransactions,
});

// Todos os endpoints exigem autenticação
router.use(requireAuth);

// GET /api/v1/transactions
router.get('/', async (req, res) => {
  const result = await txService.listTransactions(
    { ...req.query, userId: req.auth.userId },
    txDeps
  );
  res.json(result);
});

// GET /api/v1/transactions/:id
router.get('/:id', async (req, res) => {
  const result = await txService.getTransaction(req.params.id, req.auth.userId, txDeps);
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

// POST /api/v1/transactions
router.post('/', async (req, res) => {
  const input  = { ...req.body, userId: req.auth.userId };
  const result = await txService.createTransaction(input, txDeps);
  if (!result.ok) return res.status(400).json(result);
  res.status(201).json(result);
});

// POST /api/v1/transactions/recurring
router.post('/recurring', async (req, res) => {
  const input  = { ...req.body, userId: req.auth.userId };
  const result = await txService.createRecurringTransactions(input, txDeps);
  if (!result.ok) return res.status(400).json(result);
  res.status(201).json(result);
});

// POST /api/v1/transactions/installments
router.post('/installments', async (req, res) => {
  const input  = { ...req.body, userId: req.auth.userId };
  const result = await txService.createInstallments(input, txDeps);
  if (!result.ok) return res.status(400).json(result);
  res.status(201).json(result);
});

// POST /api/v1/transactions/:id/split
router.post('/:id/split', async (req, res) => {
  const result = await txService.splitTransaction(
    { originalTxId: req.params.id, splits: req.body.splits },
    txDeps
  );
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

// DELETE /api/v1/transactions/:id  (soft delete)
router.delete('/:id', async (req, res) => {
  const result = await txService.softDeleteTransaction(req.params.id, txDeps);
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

// POST /api/v1/transactions/:id/undo  (desfazer em 5s)
router.post('/:id/undo', async (req, res) => {
  const result = await txService.undoDeleteTransaction(
    req.params.id, req.body.deletionToken, txDeps
  );
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

// POST /api/v1/transactions/import  (OFX / CSV / PDF)
router.post('/import', async (req, res) => {
  const { transactions: raw, walletId, source } = req.body;
  if (!Array.isArray(raw) || !walletId) {
    return res.status(400).json({ ok: false, error: 'transactions[] e walletId são obrigatórios' });
  }
  const result = await txService.importTransactions(
    raw,
    { userId: req.auth.userId, walletId, source: source || 'csv' },
    txDeps
  );
  res.json(result);
});

module.exports = router;
