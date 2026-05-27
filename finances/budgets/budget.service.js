/**
 * @module finances/budgets/budget.service
 * @description Serviço de Orçamentos Mensais e Planejamento.
 *
 * Funcionalidades:
 *   - Orçamentos por categoria com limites mensais
 *   - Método 50/30/20 automático
 *   - Alertas aos 80% e 100% do limite
 *   - Projeção de fechamento do mês (algoritmo linear/sazonal)
 *   - Score de saúde financeira (0-100)
 *
 * PARADIGMA: 100% Funcional. ZERO classes.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const {
  Ok, Err, isOk,
  update, deepFreeze,
  sumValues, toMoney, percentOf,
  groupBy, pipe,
} = require('../../shared/fp-utils');
const { validateBudget }        = require('../../shared/validators');
const { BUDGET_THRESHOLDS, BUDGET_5030_20 } = require('../../shared/constants');
const { emitEvent, EVENTS }     = require('../../core/events/event-bus');

// ─────────────────────────────────────────────
// FACTORIES
// ─────────────────────────────────────────────

const createBudgetRecord = (data) =>
  deepFreeze({
    id:           uuidv4(),
    userId:       data.userId,
    categoryId:   data.categoryId,
    limitAmount:  toMoney(Number(data.limitAmount)),
    month:        data.month,         // 'YYYY-MM'
    method:       data.method || 'manual',  // 'manual' | '503020'
    createdAt:    new Date().toISOString(),
    updatedAt:    new Date().toISOString(),
  });

// ─────────────────────────────────────────────
// COMMANDS
// ─────────────────────────────────────────────

/**
 * Cria ou atualiza um orçamento mensal por categoria.
 * @param {object} input
 * @param {{ findBudget, saveBudget, updateBudget }} deps
 * @returns {Promise<Result>}
 */
const upsertBudget = async (input, deps) => {
  const validated = validateBudget(input);
  if (!isOk(validated)) return validated;
  const data = validated.value;

  const existing = await deps.findBudget(data.userId, data.categoryId, data.month);
  if (existing) {
    const updated = update(existing, {
      limitAmount: data.limitAmount,
      updatedAt:   new Date().toISOString(),
    });
    await deps.updateBudget(existing.id, updated);
    return Ok(updated);
  }

  const budget = createBudgetRecord(data);
  await deps.saveBudget(budget);
  return Ok(budget);
};

/**
 * Aplica o método 50/30/20 automaticamente.
 * Distribui a renda líquida mensal entre as categorias.
 *
 * @param {{ userId: string, month: string, netIncome: number }} input
 * @param {{ getBudgetsByMonth, findDefaultCategories, saveBudget }} deps
 * @returns {Promise<Result>}
 */
const apply503020Budget = async ({ userId, month, netIncome }, deps) => {
  if (netIncome <= 0) return Err('Renda líquida deve ser positiva');

  const allocations = Object.entries(BUDGET_5030_20).map(([key, { percentage, label }]) => ({
    key,
    label,
    amount: toMoney(netIncome * percentage),
  }));

  // Cria budgets para cada bloco do método
  const budgets = await Promise.all(
    allocations.map(({ key, label, amount }) =>
      upsertBudget(
        { userId, categoryId: `method_503020_${key}`, limitAmount: amount, month, method: '503020' },
        deps
      )
    )
  );

  const errors = budgets.filter((r) => !r.ok);
  if (errors.length > 0) return Err('Falha ao aplicar método 50/30/20', errors);

  return Ok(Object.freeze({ method: '503020', month, netIncome, allocations }));
};

// ─────────────────────────────────────────────
// QUERIES
// ─────────────────────────────────────────────

/**
 * Retorna o status de todos os orçamentos de um mês com % de uso.
 *
 * @param {{ userId: string, month: string }} params
 * @param {{ getBudgetsByMonth, getSpentByCategory }} deps
 * @returns {Promise<Result>}
 */
const getBudgetStatus = async ({ userId, month }, deps) => {
  const budgets = await deps.getBudgetsByMonth(userId, month);
  const spent   = await deps.getSpentByCategory(userId, month);  // { categoryId: totalSpent }

  const statusList = budgets.map((budget) => {
    const spentAmount = spent[budget.categoryId] || 0;
    const usageRatio  = budget.limitAmount > 0 ? spentAmount / budget.limitAmount : 0;
    const status      = getBudgetStatusLabel(usageRatio);

    return deepFreeze({
      ...budget,
      spentAmount,
      remainingAmount: toMoney(budget.limitAmount - spentAmount),
      usageRatio:      toMoney(usageRatio),
      usagePercent:    toMoney(usageRatio * 100),
      status,         // 'ok' | 'warning' | 'exceeded'
      color:          getBudgetColor(status),
    });
  });

  return Ok(Object.freeze(statusList));
};

/**
 * Calcula a projeção de fechamento do mês.
 * Algoritmo: consumo diário médio atual × dias restantes no mês.
 *
 * @param {{ userId: string, month: string }} params
 * @param {{ getDailySpending, getBudgetsByMonth }} deps
 * @returns {Promise<Result>}
 */
const getMonthProjection = async ({ userId, month }, deps) => {
  const today     = new Date();
  const [year, m] = month.split('-').map(Number);
  const daysInMonth = new Date(year, m, 0).getDate();
  const daysPassed  = today.getMonth() + 1 === m && today.getFullYear() === year
    ? today.getDate()
    : daysInMonth;
  const daysLeft    = Math.max(0, daysInMonth - daysPassed);

  // Gastos diários reais
  const dailySpending = await deps.getDailySpending(userId, month); // [{ day, amount }]
  const totalSpentSoFar = sumValues(dailySpending.map((d) => d.amount));

  // Taxa de consumo diária (media dos últimos N dias)
  const activeDays    = dailySpending.filter((d) => d.amount > 0).length || 1;
  const avgDailySpend = toMoney(totalSpentSoFar / activeDays);

  // Projeção linear
  const projectedTotal    = toMoney(totalSpentSoFar + avgDailySpend * daysLeft);
  const projectedByDay    = generateProjectionPoints(dailySpending, avgDailySpend, daysInMonth, daysPassed);

  // Compara com orçamento total
  const budgets         = await deps.getBudgetsByMonth(userId, month);
  const totalBudget     = sumValues(budgets.map((b) => b.limitAmount));
  const willExceed      = totalBudget > 0 && projectedTotal > totalBudget;
  const daysUntilBudget = willExceed && avgDailySpend > 0
    ? Math.ceil((totalBudget - totalSpentSoFar) / avgDailySpend)
    : null;

  return Ok(deepFreeze({
    month,
    daysInMonth,
    daysPassed,
    daysLeft,
    totalSpentSoFar,
    avgDailySpend,
    projectedTotal,
    totalBudget,
    willExceedBudget: willExceed,
    daysUntilBudgetExceeded: daysUntilBudget,
    projectedByDay,
    message: buildProjectionMessage(willExceed, projectedTotal, totalBudget, daysUntilBudget),
  }));
};

// ─────────────────────────────────────────────
// HEALTH SCORE (0-100)
// ─────────────────────────────────────────────

/**
 * Calcula o "Financial Health Score" de 0-100.
 * Baseado em: liquidez, índice de dívida, taxa de poupança, diversificação.
 *
 * @param {{ userId: string }} params
 * @param {{ getLastNMonthsData }} deps
 * @returns {Promise<Result>}
 */
const getHealthScore = async ({ userId }, deps) => {
  const data = await deps.getLastNMonthsData(userId, 3); // últimos 3 meses

  const score = pipe(
    () => calculateLiquidityScore(data),
    (s) => s + calculateDebtScore(data),
    (s) => s + calculateSavingsScore(data),
    (s) => s + calculateDiversificationScore(data),
    (total) => Math.min(100, Math.max(0, Math.round(total)))
  )();

  const label = getHealthLabel(score);
  const tips  = getHealthTips(data, score);

  return Ok(deepFreeze({ score, label, color: getHealthColor(score), tips }));
};

// ─────────────────────────────────────────────
// ALERTAS DE ORÇAMENTO
// ─────────────────────────────────────────────

/**
 * Verifica e dispara alertas de orçamento (chamado após cada transação).
 * @param {{ userId: string, categoryId: string, month: string }} params
 * @param {object} deps
 */
const checkBudgetAlerts = async ({ userId, categoryId, month }, deps) => {
  const budget = await deps.findBudget(userId, categoryId, month);
  if (!budget) return;

  const spent = (await deps.getSpentByCategory(userId, month))[categoryId] || 0;
  const ratio = budget.limitAmount > 0 ? spent / budget.limitAmount : 0;

  if (ratio >= BUDGET_THRESHOLDS.EXCEEDED) {
    emitEvent(EVENTS.BUDGET_ALERT_EXCEEDED, { userId, categoryId, month, spent, limit: budget.limitAmount });
  } else if (ratio >= BUDGET_THRESHOLDS.WARNING) {
    emitEvent(EVENTS.BUDGET_ALERT_80, { userId, categoryId, month, spent, limit: budget.limitAmount, percent: Math.round(ratio * 100) });
  }
};

// ─────────────────────────────────────────────
// HELPERS INTERNOS (funções puras)
// ─────────────────────────────────────────────

const getBudgetStatusLabel = (ratio) => {
  if (ratio >= BUDGET_THRESHOLDS.EXCEEDED) return 'exceeded';
  if (ratio >= BUDGET_THRESHOLDS.WARNING)  return 'warning';
  return 'ok';
};

const getBudgetColor = (status) => ({
  ok:       '#22C55E',
  warning:  '#F59E0B',
  exceeded: '#EF4444',
}[status] || '#6B7280');

const getHealthLabel = (score) => {
  if (score >= 80) return 'Excelente';
  if (score >= 60) return 'Bom';
  if (score >= 40) return 'Regular';
  if (score >= 20) return 'Atenção';
  return 'Crítico';
};

const getHealthColor = (score) => {
  if (score >= 80) return '#22C55E';
  if (score >= 60) return '#84CC16';
  if (score >= 40) return '#F59E0B';
  if (score >= 20) return '#F97316';
  return '#EF4444';
};

const calculateLiquidityScore = (data) => {
  // Liquidez: reserve ≥ 3 meses de gastos = 30pts
  const avgMonthlyExpense = sumValues(data.months.map((m) => m.totalExpenses)) / data.months.length;
  const liquidAssets      = data.liquidBalance || 0;
  const months            = avgMonthlyExpense > 0 ? liquidAssets / avgMonthlyExpense : 0;
  return Math.min(30, months * 10);
};

const calculateDebtScore = (data) => {
  // Dívida: comprometimento < 30% da renda = 25pts
  const avgIncome  = sumValues(data.months.map((m) => m.totalIncome))  / data.months.length;
  const debtPayments = data.monthlyDebtPayments || 0;
  const debtRatio  = avgIncome > 0 ? debtPayments / avgIncome : 1;
  return Math.max(0, Math.round(25 * (1 - debtRatio / 0.3)));
};

const calculateSavingsScore = (data) => {
  // Poupança: taxa ≥ 20% = 25pts
  const avgIncome  = sumValues(data.months.map((m) => m.totalIncome))  / data.months.length;
  const avgSaved   = sumValues(data.months.map((m) => m.totalSaved))   / data.months.length;
  const savingsRate = avgIncome > 0 ? avgSaved / avgIncome : 0;
  return Math.min(25, Math.round(25 * (savingsRate / 0.2)));
};

const calculateDiversificationScore = (data) => {
  // Diversificação: investimentos em ≥ 3 classes = 20pts
  const investClasses = (data.investmentClasses || []).length;
  return Math.min(20, investClasses * 7);
};

const getHealthTips = (data, score) => {
  const tips = [];
  if (score < 30)  tips.push('💡 Comece criando um fundo de emergência com 3 meses de gastos.');
  if (score < 50)  tips.push('📊 Tente seguir a regra 50/30/20 nos seus gastos mensais.');
  if (score < 70)  tips.push('📉 Reduza compromissos de dívida para menos de 30% da sua renda.');
  if (score < 90)  tips.push('🏛️ Diversifique seus investimentos em pelo menos 3 classes diferentes.');
  return tips;
};

/**
 * Gera pontos de projeção dia a dia para o gráfico.
 * @param {Array} dailySpending
 * @param {number} avgDaily
 * @param {number} daysInMonth
 * @param {number} daysPassed
 * @returns {Array}
 */
const generateProjectionPoints = (dailySpending, avgDaily, daysInMonth, daysPassed) => {
  const spendingMap = Object.fromEntries(dailySpending.map((d) => [d.day, d.amount]));
  let cumulative = 0;
  return Array.from({ length: daysInMonth }, (_, i) => {
    const day     = i + 1;
    const isActual = day <= daysPassed;
    const amount   = isActual ? (spendingMap[day] || 0) : avgDaily;
    cumulative     = toMoney(cumulative + amount);
    return { day, amount, cumulative, isProjected: !isActual };
  });
};

const buildProjectionMessage = (willExceed, projected, budget, daysUntil) => {
  if (!budget) return 'Defina um orçamento para ver projeções.';
  if (!willExceed) {
    const saving = toMoney(budget - projected);
    return `✅ No ritmo atual, você fechará o mês com R$\u00A0${saving.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} de sobra.`;
  }
  if (daysUntil !== null && daysUntil > 0) {
    return `⚠️ No ritmo atual, você ultrapassará o orçamento em ${daysUntil} dia(s).`;
  }
  return `🔴 Orçamento já ultrapassado! Você gastou R$\u00A0${(projected - budget).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} a mais.`;
};

// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// FUNÇÕES PURAS SÍNCRONAS (para testes unitários)
// ─────────────────────────────────────────────

/**
 * Calcula status de um orçamento com base no valor gasto.
 * @param {{limitAmount:number, categoryName:string}} budget
 * @param {number} spent
 * @returns {{status:'ok'|'warning'|'danger', percentage:number, remaining:number, spent:number, limit:number}}
 */
const calculateBudgetStatus = (budget, spent) => {
  const percentage = toMoney((spent / budget.limitAmount) * 100);
  const remaining  = toMoney(budget.limitAmount - spent);
  const status     = percentage >= 100 ? 'danger' : percentage >= 80 ? 'warning' : 'ok';
  return Object.freeze({ status, percentage, remaining, spent, limit: budget.limitAmount });
};

/**
 * Projeta o fechamento do mês linearmente.
 * @param {Array<{day:number, date:string, amount:number}>} dailyData
 * @param {string} month — 'YYYY-MM'
 * @param {number} budgetLimit
 */
const getMonthProjectionPure = (dailyData, month, budgetLimit) => {
  if (!dailyData.length) {
    return Object.freeze({ projectedTotal: 0, willExceed: false, daysRemaining: 0, surplusOrDeficit: budgetLimit });
  }
  const [year, m]   = month.split('-').map(Number);
  const totalDays   = new Date(year, m, 0).getDate();
  const today       = dailyData[dailyData.length - 1]?.day || 1;
  const spentSoFar  = toMoney(dailyData.reduce((s, d) => s + d.amount, 0));
  const dailyAvg    = spentSoFar / today;
  const projected   = toMoney(dailyAvg * totalDays);
  const daysRemaining = totalDays - today;
  return Object.freeze({
    projectedTotal:   projected,
    willExceed:       projected > budgetLimit,
    daysRemaining,
    surplusOrDeficit: toMoney(budgetLimit - projected),
    dailyAvg:         toMoney(dailyAvg),
    spentSoFar,
  });
};

/**
 * Calcula o Health Score financeiro (0–100).
 */
const calculateHealthScore = ({ liquidBalance, monthlyIncome, monthlyExpenses, totalDebt, monthlyDebtPayments, investmentClasses }) => {
  // Componente 1: Reserva de emergência (peso 30) — ideal: 6 meses de despesa
  const emergencyMonths  = monthlyExpenses > 0 ? liquidBalance / monthlyExpenses : 0;
  const emergencyScore   = Math.min(30, (emergencyMonths / 6) * 30);

  // Componente 2: Taxa de poupança (peso 30) — ideal: ≥ 20%
  const savingsRate      = monthlyIncome > 0 ? (monthlyIncome - monthlyExpenses) / monthlyIncome : 0;
  const savingsScore     = Math.min(30, Math.max(0, (savingsRate / 0.2) * 30));

  // Componente 3: Comprometimento de dívida (peso 25) — ideal: < 30% da renda
  const debtRatio        = monthlyIncome > 0 ? monthlyDebtPayments / monthlyIncome : 1;
  const debtScore        = Math.max(0, 25 - (debtRatio / 0.3) * 25);

  // Componente 4: Diversificação de investimentos (peso 15)
  const diversityScore   = Math.min(15, (investmentClasses || []).length * 5);

  const score = Math.round(emergencyScore + savingsScore + debtScore + diversityScore);
  const grade = score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : score >= 20 ? 'D' : 'F';

  return Object.freeze({ score, grade, breakdown: { emergencyScore, savingsScore, debtScore, diversityScore } });
};

/**
 * Distribui renda líquida pelo método 50/30/20.
 * @param {number} netIncome
 */
const apply503020 = (netIncome) => {
  return Object.freeze({
    needs:   Object.freeze({ label: 'Necessidades', percentage: 0.5,  amount: toMoney(netIncome * 0.5) }),
    wants:   Object.freeze({ label: 'Desejos',      percentage: 0.3,  amount: toMoney(netIncome * 0.3) }),
    savings: Object.freeze({ label: 'Poupança',     percentage: 0.2,  amount: toMoney(netIncome * 0.2) }),
  });
};

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = Object.freeze({
  upsertBudget,
  apply503020Budget,
  getBudgetStatus,
  getMonthProjection,
  getHealthScore,
  checkBudgetAlerts,
  getMonthProjectionPure,
  // Pure (para testes unitários)
  calculateBudgetStatus,
  calculateHealthScore,
  apply503020,
});
