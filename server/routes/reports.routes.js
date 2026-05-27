/**
 * @module server/routes/reports
 * @description Rotas de relatórios, analytics e exportação (E08 + LGPD).
 */
'use strict';

const { Router }  = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const analyticsSvc = require('../../reports/analytics/analytics.service');

const router = Router();
router.use(requireAuth);

const DEPS = () => ({
  txRepo:     require('../../database/repositories/transaction.repository'),
  walletRepo: require('../../database/repositories/wallet.repository'),
  budgetRepo: require('../../database/repositories/budget.repository'),
  goalRepo:   require('../../database/repositories/goal.repository'),
  userRepo:   require('../../database/repositories/user.repository'),
});

// ── Fluxo de caixa mensal ──────────────────────────────────────────────────
router.get('/cashflow', async (req, res) => {
  const { month, entityType = 'all' } = req.query;
  const result = await analyticsSvc.getCashflowReport(
    { userId: req.user.sub, month: month || getCurrentMonth(), entityType },
    DEPS()
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ data: result.value });
});

// ── Comparativo mensal por categorias ─────────────────────────────────────
router.get('/comparison', async (req, res) => {
  const { month } = req.query;
  const result = await analyticsSvc.getMonthlyComparison(
    { userId: req.user.sub, month: month || getCurrentMonth() },
    DEPS()
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ data: result.value });
});

// ── Top categorias ─────────────────────────────────────────────────────────
router.get('/categories', async (req, res) => {
  const { month, type = 'expense', limit = 10 } = req.query;
  const result = await analyticsSvc.getCategoryBreakdown(
    { userId: req.user.sub, month: month || getCurrentMonth(), type, limit: Number(limit) },
    DEPS()
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ data: result.value });
});

// ── Detecção de anomalias ──────────────────────────────────────────────────
router.get('/anomalies', async (req, res) => {
  const result = await analyticsSvc.detectAnomalies(
    { userId: req.user.sub, months: 6 },
    DEPS()
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ data: result.value });
});

// ── Financial Health Score ─────────────────────────────────────────────────
router.get('/health-score', async (req, res) => {
  const result = await analyticsSvc.getHealthScore(
    { userId: req.user.sub },
    DEPS()
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ data: result.value });
});

// ── Cubo MEI (segregação PF vs PJ) ────────────────────────────────────────
router.get('/mei', async (req, res) => {
  const { month } = req.query;
  const result = await analyticsSvc.getMEICube(
    { userId: req.user.sub, month: month || getCurrentMonth() },
    DEPS()
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ data: result.value });
});

// ── Exportação CSV ─────────────────────────────────────────────────────────
router.get('/export/csv', async (req, res) => {
  const { month, entityType = 'all' } = req.query;
  const result = await analyticsSvc.exportToCSV(
    { userId: req.user.sub, month, entityType },
    DEPS()
  );
  if (!result.ok) return res.status(400).json({ error: result.error });

  res.setHeader('Content-Type',        'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="norte-${month || 'relatorio'}.csv"`);
  res.send('\uFEFF' + result.value); // BOM para Excel PT-BR
});

// ── Exportação LGPD (ZIP completo) ────────────────────────────────────────
router.get('/export/lgpd', async (req, res) => {
  const result = await analyticsSvc.exportLGPD(
    { userId: req.user.sub },
    DEPS()
  );
  if (!result.ok) return res.status(400).json({ error: result.error });

  res.setHeader('Content-Type',        'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="norte-meus-dados.zip"');
  res.send(result.value);
});

// ─── Helper ────────────────────────────────────────────────────────────────
const getCurrentMonth = () => new Date().toISOString().slice(0, 7);

module.exports = router;
