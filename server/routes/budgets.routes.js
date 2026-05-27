/**
 * @module server/routes/budgets.routes
 */
'use strict';

const express    = require('express');
const router     = express.Router();
const budgetSvc  = require('../../finances/budgets/budget.service');
const budgetRepo = require('../../database/repositories/budget.repository');
const txRepo     = require('../../database/repositories/transaction.repository');
const { requireAuth } = require('../middleware/auth.middleware');

router.use(requireAuth);

const deps = Object.freeze({
  findBudget:          budgetRepo.findBudget,
  saveBudget:          budgetRepo.saveBudget,
  updateBudget:        budgetRepo.updateBudget,
  getBudgetsByMonth:   budgetRepo.getBudgetsByMonth,
  getSpentByCategory:  txRepo.getSpentByCategory,
  getDailySpending:    txRepo.getDailySpending,
  getLastNMonthsData:  async (userId, months) => {
    // Agrega dados dos últimos N meses para o Health Score
    const rows = txRepo.getMonthlyBalanceHistory(userId, months);
    return {
      months:          rows,
      liquidBalance:   rows.reduce((s, r) => s + r.netWorth, 0),
      monthlyDebtPayments: 0,  // TODO: extrair de lançamentos categorizados como dívida
      investmentClasses:   [],  // TODO: buscar do repositório de investimentos
    };
  },
});

// GET /api/v1/budgets/status?month=YYYY-MM
router.get('/status', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ ok: false, error: 'month obrigatório (YYYY-MM)' });
  const result = await budgetSvc.getBudgetStatus({ userId: req.auth.userId, month }, deps);
  res.json(result);
});

// GET /api/v1/budgets/projection?month=YYYY-MM
router.get('/projection', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ ok: false, error: 'month obrigatório' });
  const result = await budgetSvc.getMonthProjection({ userId: req.auth.userId, month }, deps);
  res.json(result);
});

// GET /api/v1/budgets/health-score
router.get('/health-score', async (req, res) => {
  const result = await budgetSvc.getHealthScore({ userId: req.auth.userId }, deps);
  res.json(result);
});

// POST /api/v1/budgets
router.post('/', async (req, res) => {
  const result = await budgetSvc.upsertBudget({ ...req.body, userId: req.auth.userId }, deps);
  if (!result.ok) return res.status(400).json(result);
  res.status(201).json(result);
});

// POST /api/v1/budgets/apply-503020
router.post('/apply-503020', async (req, res) => {
  const { netIncome, month } = req.body;
  const result = await budgetSvc.apply503020Budget(
    { userId: req.auth.userId, month, netIncome: Number(netIncome) },
    deps
  );
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

module.exports = router;
