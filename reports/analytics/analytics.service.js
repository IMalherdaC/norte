/**
 * @module reports/analytics/analytics.service
 * @description Serviço funcional de analytics e relatórios (E08 + E09-MEI).
 *
 * Funções puras para:
 *  - Fluxo de caixa mensal
 *  - Comparativo mensal
 *  - Breakdown por categoria
 *  - Detecção de anomalias (z-score)
 *  - Financial Health Score (0–100)
 *  - Cubo MEI: segregação PF × PJ
 *  - Exportação CSV
 *  - Exportação LGPD (JSON/ZIP)
 */
'use strict';

const { Ok, Err, groupBy, roundCents } = require('../../shared');

// ─────────────────────────────────────────────
// FUNÇÕES PURAS — ANALYTICS
// ─────────────────────────────────────────────

/**
 * Calcula totais de receita, despesa e saldo a partir de uma lista de transações.
 * @param {Array} transactions
 * @returns {{ income, expenses, balance, savingsRate }}
 */
const calcCashflowTotals = (transactions) => {
  const income   = roundCents(transactions.filter(t => t.type === 'income')
    .reduce((s, t) => s + t.amount, 0));
  const expenses = roundCents(transactions.filter(t => t.type === 'expense')
    .reduce((s, t) => s + t.amount, 0));
  const balance  = roundCents(income - expenses);
  const savingsRate = income > 0 ? roundCents((balance / income) * 100) : 0;
  return Object.freeze({ income, expenses, balance, savingsRate });
};

/**
 * Agrupa transações por categoria e calcula o total de cada uma.
 * @param {Array} transactions
 * @returns {Array<{ categoryId, total, count, percentage }>}
 */
const calcCategoryBreakdown = (transactions) => {
  const grouped  = groupBy(transactions, (t) => t.categoryId || 'sem-categoria');
  const grandTotal = transactions.reduce((s, t) => s + t.amount, 0);

  return Object.entries(grouped)
    .map(([categoryId, txs]) => {
      const total      = roundCents(txs.reduce((s, t) => s + t.amount, 0));
      const count      = txs.length;
      const percentage = grandTotal > 0 ? roundCents((total / grandTotal) * 100) : 0;
      return Object.freeze({ categoryId, total, count, percentage });
    })
    .sort((a, b) => b.total - a.total);
};

/**
 * Detecta anomalias estatísticas por z-score (limiar ≥ 2.0).
 * "Você gastou 3x mais em Uber este mês do que sua média."
 *
 * @param {Array<{ category, amounts: number[] }>} historicalData
 * @returns {Array<{ category, current, mean, stdDev, zScore, multiplier, severity }>}
 */
const detectAnomaliesByZScore = (historicalData) => {
  const THRESHOLD = 2.0;

  return historicalData
    .filter(({ amounts }) => amounts.length >= 2)
    .map(({ category, amounts }) => {
      const n       = amounts.length;
      const current = amounts[amounts.length - 1];
      const past    = amounts.slice(0, -1);
      const mean    = roundCents(past.reduce((s, v) => s + v, 0) / past.length);
      const variance = past.reduce((s, v) => s + (v - mean) ** 2, 0) / past.length;
      const stdDev  = roundCents(Math.sqrt(variance));
      const zScore  = stdDev > 0 ? roundCents((current - mean) / stdDev) : 0;
      const multiplier = mean > 0 ? roundCents(current / mean) : 0;
      const severity   = zScore >= 3 ? 'critical' : 'warning';

      return Object.freeze({ category, current, mean, stdDev, zScore, multiplier, severity });
    })
    .filter(({ zScore }) => Math.abs(zScore) >= THRESHOLD)
    .sort((a, b) => b.zScore - a.zScore);
};

/**
 * Calcula Financial Health Score (0–100).
 * Baseado em 4 dimensões: liquidez, dívida, poupança, diversificação.
 * Reutiliza função do budget.service como sub-score.
 *
 * @param {{ monthlyIncome, monthlyExpenses, liquidReserve, totalDebt }} metrics
 * @returns {number}
 */
const calcHealthScore = ({ monthlyIncome, monthlyExpenses, liquidReserve, totalDebt }) => {
  // Poupança: % do salário guardado (0–40 pts)
  const savingsRate   = monthlyIncome > 0 ? (monthlyIncome - monthlyExpenses) / monthlyIncome : 0;
  const savingsScore  = Math.min(40, Math.round(savingsRate * 200)); // 20% poupança = 40 pts

  // Liquidez: meses de reserva (0–30 pts)
  const months        = monthlyExpenses > 0 ? liquidReserve / monthlyExpenses : 0;
  const liquidScore   = Math.min(30, Math.round((months / 6) * 30)); // 6 meses = 30 pts

  // Dívida: debt-to-income (0–30 pts)
  const dtiRatio      = monthlyIncome > 0 ? totalDebt / (monthlyIncome * 12) : 1;
  const debtScore     = Math.max(0, Math.round((1 - Math.min(1, dtiRatio)) * 30));

  const total = Math.min(100, savingsScore + liquidScore + debtScore);
  return Object.freeze({
    score:       total,
    breakdown:   Object.freeze({ savingsScore, liquidScore, debtScore }),
    label:       total >= 75 ? 'Excelente' : total >= 55 ? 'Bom' : total >= 35 ? 'Regular' : 'Crítico',
    savingsRate: roundCents(savingsRate * 100),
  });
};

/**
 * Calcula cubo MEI: agrega transações em dois cubos (PF × PJ).
 * @param {Array} transactions
 * @returns {{ pf, pj, taxReserve, dasMonthly }}
 */
const buildMEICube = (transactions) => {
  const pf = calcCashflowTotals(transactions.filter(t => t.entityType !== 'pj'));
  const pj = calcCashflowTotals(transactions.filter(t => t.entityType === 'pj'));

  // Cálculo de impostos MEI (valores 2026)
  const DAS_MONTHLY    = 75.90; // DAS MEI Comércio/Serviços (base fixa)
  const IR_RESERVE_PCT = 0.11;  // 11% do lucro líquido PJ para IRPF anual
  const taxReserve     = roundCents(Math.max(0, pj.balance) * IR_RESERVE_PCT);

  return Object.freeze({ pf, pj, taxReserve, dasMonthly: DAS_MONTHLY });
};

/**
 * Gera CSV de transações para exportação.
 * @param {Array} transactions
 * @returns {string} — CSV formatado, UTF-8
 */
const buildCSV = (transactions) => {
  const headers = [
    'Data', 'Tipo', 'Descrição', 'Categoria', 'Valor (R$)',
    'Conta', 'Tags', 'Método de Pagamento', 'Entidade', 'Criado em',
  ];

  const rows = transactions.map((t) => [
    t.date,
    t.type === 'income' ? 'Receita' : t.type === 'expense' ? 'Despesa' : 'Transferência',
    `"${(t.description || '').replace(/"/g, '""')}"`,
    t.categoryId || '',
    t.amount.toFixed(2).replace('.', ','),
    t.walletId || '',
    (t.tags || []).join(';'),
    t.paymentMethod || '',
    t.entityType === 'pj' ? 'PJ/MEI' : 'PF',
    t.createdAt || '',
  ]);

  return [headers.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');
};

// ─────────────────────────────────────────────
// SERVIÇOS (com I/O — injeção de deps)
// ─────────────────────────────────────────────

const getCashflowReport = async ({ userId, month, entityType }, { txRepo }) => {
  try {
    const allTx = txRepo.queryTransactions({
      userId, month, entityType: entityType === 'all' ? undefined : entityType,
      limit: 1000, skip: 0,
    }).rows;

    const totals   = calcCashflowTotals(allTx);
    const byDay    = groupBy(allTx, (t) => t.date);
    const daily    = Object.entries(byDay).map(([date, txs]) => ({
      date, ...calcCashflowTotals(txs),
    })).sort((a, b) => a.date.localeCompare(b.date));

    return Ok(Object.freeze({ month, totals, daily, transactions: allTx }));
  } catch (e) {
    return Err('Falha ao gerar relatório de fluxo de caixa', e.message);
  }
};

const getMonthlyComparison = async ({ userId, month }, { txRepo }) => {
  try {
    // Mês atual e anterior
    const [year, mon]  = month.split('-').map(Number);
    const prevDate     = new Date(year, mon - 2, 1);
    const prevMonth    = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

    const current = txRepo.queryTransactions({ userId, month, type: 'expense', limit: 1000, skip: 0 }).rows;
    const prev    = txRepo.queryTransactions({ userId, month: prevMonth, type: 'expense', limit: 1000, skip: 0 }).rows;

    const currentBycat = groupBy(current, t => t.categoryId || 'sem-categoria');
    const prevBycat    = groupBy(prev,    t => t.categoryId || 'sem-categoria');

    const allCategories = new Set([...Object.keys(currentBycat), ...Object.keys(prevBycat)]);
    const comparison = [...allCategories].map(catId => {
      const c = (currentBycat[catId] || []).reduce((s, t) => s + t.amount, 0);
      const p = (prevBycat[catId]    || []).reduce((s, t) => s + t.amount, 0);
      const diff = roundCents(c - p);
      const pct  = p > 0 ? roundCents((diff / p) * 100) : null;
      return Object.freeze({ categoryId: catId, current: roundCents(c), prev: roundCents(p), diff, pct });
    }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    return Ok(Object.freeze({ month, prevMonth, comparison }));
  } catch (e) {
    return Err('Falha ao gerar comparativo mensal', e.message);
  }
};

const getCategoryBreakdown = async ({ userId, month, type, limit }, { txRepo }) => {
  try {
    const txs = txRepo.queryTransactions({ userId, month, type, limit: 1000, skip: 0 }).rows;
    const breakdown = calcCategoryBreakdown(txs).slice(0, limit);
    return Ok(breakdown);
  } catch (e) {
    return Err('Falha ao gerar breakdown de categorias', e.message);
  }
};

const detectAnomalies = async ({ userId, months = 6 }, { txRepo }) => {
  try {
    const now = new Date();
    // Coleta histórico de N meses
    const monthlyData = Array.from({ length: months }, (_, i) => {
      const d = new Date(now);
      d.setMonth(d.getMonth() - (months - 1 - i));
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }).map(m => txRepo.queryTransactions({ userId, month: m, type: 'expense', limit: 1000, skip: 0 }).rows);

    // Agrega por categoria em cada mês
    const categoryMonths = {};
    monthlyData.forEach(txs => {
      const grouped = groupBy(txs, t => t.categoryId || 'sem-categoria');
      Object.entries(grouped).forEach(([cat, items]) => {
        if (!categoryMonths[cat]) categoryMonths[cat] = [];
        categoryMonths[cat].push(items.reduce((s, t) => s + t.amount, 0));
      });
    });

    const historicalData = Object.entries(categoryMonths)
      .map(([category, amounts]) => ({ category, amounts }));

    const anomalies = detectAnomaliesByZScore(historicalData);
    return Ok(anomalies);
  } catch (e) {
    return Err('Falha na detecção de anomalias', e.message);
  }
};

const getHealthScore = async ({ userId }, { txRepo, walletRepo, goalRepo }) => {
  try {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const txs          = txRepo.queryTransactions({ userId, month: currentMonth, limit: 1000, skip: 0 }).rows;
    const wallets      = walletRepo.listWallets(userId);
    const totals       = calcCashflowTotals(txs);
    const liquidReserve = wallets.reduce((s, w) => s + (w.balance > 0 ? w.balance : 0), 0);

    const result = calcHealthScore({
      monthlyIncome:   totals.income,
      monthlyExpenses: totals.expenses,
      liquidReserve,
      totalDebt:       0, // TODO: implementar módulo de dívidas
    });

    return Ok(result);
  } catch (e) {
    return Err('Falha ao calcular health score', e.message);
  }
};

const getMEICube = async ({ userId, month }, { txRepo }) => {
  try {
    const txs = txRepo.queryTransactions({ userId, month, limit: 1000, skip: 0 }).rows;
    const cube = buildMEICube(txs);
    return Ok(cube);
  } catch (e) {
    return Err('Falha ao gerar cubo MEI', e.message);
  }
};

const exportToCSV = async ({ userId, month, entityType }, { txRepo }) => {
  try {
    const txs = txRepo.queryTransactions({
      userId, month, entityType: entityType === 'all' ? undefined : entityType,
      limit: 5000, skip: 0,
    }).rows;
    return Ok(buildCSV(txs));
  } catch (e) {
    return Err('Falha ao exportar CSV', e.message);
  }
};

const exportLGPD = async ({ userId }, { txRepo, walletRepo, goalRepo, budgetRepo, userRepo }) => {
  try {
    const archiver = require('archiver');
    const { Readable } = require('stream');
    const { PassThrough } = require('stream');

    const user     = userRepo.findUserById(userId);
    const wallets  = walletRepo.listWallets(userId);
    const txs      = txRepo.queryTransactions({ userId, limit: 99999, skip: 0 }).rows;
    const budgets  = budgetRepo.getBudgetsByMonth(userId, new Date().toISOString().slice(0, 7));
    const goals    = goalRepo.listGoals(userId);

    const { passwordHash, twoFactorSecret, ...safeUser } = user;

    const payload = {
      exportedAt: new Date().toISOString(),
      user:       safeUser,
      wallets,
      transactions: txs,
      budgets,
      goals,
    };

    // Gera ZIP em memória
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks  = [];
    archive.on('data', c => chunks.push(c));
    await new Promise((resolve, reject) => {
      archive.on('end',   resolve);
      archive.on('error', reject);
      archive.append(JSON.stringify(payload, null, 2), { name: 'norte-meus-dados.json' });
      archive.append(buildCSV(txs), { name: 'transacoes.csv' });
      archive.finalize();
    });

    return Ok(Buffer.concat(chunks));
  } catch (e) {
    return Err('Falha ao gerar exportação LGPD', e.message);
  }
};

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────


// ─────────────────────────────────────────────
// FUNÇÕES ADAPTADAS — assinaturas dos testes legados
// ─────────────────────────────────────────────

/**
 * detectAnomaliesPure(transactions, categoryId, months) — assinatura dos testes.
 * Converte array flat de {categoryId, amount} em historicalData e detecta anomalias.
 */
const detectAnomaliesPure = (transactions, categoryId, months) => {
  const filtered = transactions.filter(t => t.categoryId === categoryId);
  if (filtered.length < 2) return [];
  const amounts = filtered.map(t => t.amount);
  const result  = detectAnomaliesByZScore([{ category: categoryId, amounts }]);
  // Retorna array com objeto rico + campo isAnomaly
  if (!result.length) {
    // sem anomalia — retorna array com objeto marcado como não-anomalia
    const n    = amounts.length;
    const mean = amounts.slice(0,-1).reduce((s,v)=>s+v,0) / Math.max(1, n-1);
    return [{ category: categoryId, current: amounts[n-1], mean, zScore: 0, isAnomaly: false }];
  }
  return result.map(a => Object.freeze({ ...a, isAnomaly: true }));
};

/**
 * calculateMEITaxReservation(grossRevenue) — assinatura dos testes.
 */
const calculateMEITaxReservation = (grossRevenue) => {
  const DAS         = 75.90;             // valor fixo MEI 2026
  const IR_RATE     = 0.11;             // 11% do lucro líquido
  const provisioning = roundCents(Math.max(0, grossRevenue) * IR_RATE);
  return Object.freeze({ das: DAS, provisioning, total: roundCents(DAS + provisioning) });
};

/**
 * buildCashFlowSummary(transactions, entityType?) — assinatura dos testes.
 * Retorna { totalIncome, totalExpenses, netBalance, pf, pj }.
 */
const buildCashFlowSummary = (transactions, entityType) => {
  const filtered = entityType && entityType !== 'all'
    ? transactions.filter(t => t.entityType === entityType)
    : transactions;

  const totals = calcCashflowTotals(filtered);
  const pfTotals = calcCashflowTotals(transactions.filter(t => t.entityType !== 'pj'));
  const pjTotals = calcCashflowTotals(transactions.filter(t => t.entityType === 'pj'));

  return Object.freeze({
    totalIncome:    totals.income,
    totalExpenses:  totals.expenses,
    netBalance:     totals.balance,
    savingsRate:    totals.savingsRate,
    pf: Object.freeze({ totalIncome: pfTotals.income, totalExpenses: pfTotals.expenses, netBalance: pfTotals.balance }),
    pj: Object.freeze({ totalIncome: pjTotals.income, totalExpenses: pjTotals.expenses, netBalance: pjTotals.balance }),
  });
};

module.exports = Object.freeze({
  // Funções puras (testáveis) — nomes canônicos
  calcCashflowTotals,
  calcCategoryBreakdown,
  detectAnomaliesByZScore,
  calcHealthScore,
  buildMEICube,
  buildCSV,
  // Aliases para compatibilidade com testes existentes
  detectAnomaliesPure,
  calculateMEITaxReservation,
  buildCashFlowSummary,
  // Serviços com I/O
  getCashflowReport,
  getMonthlyComparison,
  getCategoryBreakdown,
  detectAnomalies,
  getHealthScore,
  getMEICube,
  exportToCSV,
  exportLGPD,
});
