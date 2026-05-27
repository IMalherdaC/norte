/**
 * @module finances/goals/goal.service
 * @description Serviço de Metas e Sonhos Financeiros.
 *
 * Funcionalidades:
 *   - Criação de metas com valor alvo, prazo e conta vinculada
 *   - Cálculo de PMT (simulação de aportes baseados na Selic)
 *   - Barra de progresso percentual
 *   - Detecção de meta concluída
 *
 * PARADIGMA: 100% Funcional. ZERO classes.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const {
  Ok, Err, isOk,
  update, deepFreeze,
  toMoney, percentOf,
  pmt, fv,
} = require('../../shared/fp-utils');
const { validateGoal }      = require('../../shared/validators');
const { emitEvent, EVENTS } = require('../../core/events/event-bus');

// ─────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────

const createGoalRecord = (data) =>
  deepFreeze({
    id:             uuidv4(),
    userId:         data.userId,
    name:           data.name,
    description:    data.description || '',
    targetAmount:   toMoney(Number(data.targetAmount)),
    currentAmount:  toMoney(Number(data.currentAmount || 0)),
    deadline:       data.deadline,
    walletId:       data.walletId || null,
    icon:           data.icon || '🎯',
    color:          data.color || '#6366F1',
    isCompleted:    false,
    completedAt:    null,
    createdAt:      new Date().toISOString(),
    updatedAt:      new Date().toISOString(),
  });

// ─────────────────────────────────────────────
// COMMANDS
// ─────────────────────────────────────────────

/**
 * Cria uma nova meta financeira.
 * @param {object} input
 * @param {{ saveGoal }} deps
 * @returns {Promise<Result>}
 */
const createGoal = async (input, deps) => {
  const validated = validateGoal(input);
  if (!isOk(validated)) return validated;

  const goal = createGoalRecord(validated.value);
  await deps.saveGoal(goal);
  return Ok(goal);
};

/**
 * Atualiza o progresso de uma meta (aporte).
 * @param {{ goalId: string, userId: string, amount: number }} input
 * @param {{ findGoal, updateGoal }} deps
 * @returns {Promise<Result>}
 */
const contributeToGoal = async ({ goalId, userId, amount }, deps) => {
  const goal = await deps.findGoal(goalId);
  if (!goal) return Err('Meta não encontrada');
  if (goal.userId !== userId) return Err('Acesso negado');
  if (goal.isCompleted) return Err('Esta meta já foi concluída');

  const contribution   = toMoney(Number(amount));
  if (contribution <= 0) return Err('Valor do aporte deve ser positivo');

  const newAmount      = toMoney(goal.currentAmount + contribution);
  const isNowCompleted = newAmount >= goal.targetAmount;

  const updated = update(goal, {
    currentAmount: newAmount,
    isCompleted:   isNowCompleted,
    completedAt:   isNowCompleted ? new Date().toISOString() : null,
    updatedAt:     new Date().toISOString(),
  });

  await deps.updateGoal(goalId, updated);

  if (isNowCompleted) {
    emitEvent(EVENTS.GOAL_COMPLETED, { goalId, userId, name: goal.name, targetAmount: goal.targetAmount });
  }

  return Ok(deepFreeze({
    goal:        updated,
    contributed: contribution,
    isCompleted: isNowCompleted,
    progress:    calculateProgress(updated),
  }));
};

// ─────────────────────────────────────────────
// QUERIES
// ─────────────────────────────────────────────

/**
 * Retorna o progresso e a simulação PMT de uma meta.
 *
 * @param {{ goalId: string, userId: string, selicRate?: number }} params
 * @param {{ findGoal }} deps
 * @returns {Promise<Result>}
 */
const getGoalSimulation = async ({ goalId, userId, selicRate }, deps) => {
  const goal = await deps.findGoal(goalId);
  if (!goal) return Err('Meta não encontrada');
  if (goal.userId !== userId) return Err('Acesso negado');

  const progress        = calculateProgress(goal);
  const remaining       = toMoney(goal.targetAmount - goal.currentAmount);
  const monthsLeft      = getMonthsUntilDeadline(goal.deadline);
  const monthlyRate     = getMonthlyRate(selicRate);

  // PMT — aporte mensal necessário para atingir a meta no prazo
  // com a taxa Selic mensal como rendimento
  const monthlyPayment = remaining > 0 && monthsLeft > 0
    ? Math.abs(pmt(monthlyRate, monthsLeft, 0, -remaining))
    : 0;

  // Simulações alternativas
  const scenarios = generateScenarios(remaining, monthsLeft, monthlyRate);

  // Valor futuro se manter o aporte atual
  const currentMonthlyContribution = goal.lastMonthlyContribution || 0;
  const projectedFV = currentMonthlyContribution > 0
    ? fv(monthlyRate, monthsLeft, -currentMonthlyContribution, -goal.currentAmount)
    : null;

  return Ok(deepFreeze({
    goal,
    progress,
    remaining,
    monthsLeft,
    monthlyPayment,
    projectedFV,
    willReachGoal: projectedFV !== null && projectedFV >= goal.targetAmount,
    scenarios,
    selicRateUsed: monthlyRate * 12 * 100, // % a.a.
  }));
};

/**
 * Lista todas as metas de um usuário com progresso.
 * @param {string} userId
 * @param {{ listGoals }} deps
 * @returns {Promise<Result>}
 */
const listGoals = async (userId, deps) => {
  const goals = await deps.listGoals(userId);
  const withProgress = goals.map((goal) => ({
    ...goal,
    progress: calculateProgress(goal),
    monthsLeft: getMonthsUntilDeadline(goal.deadline),
  }));
  return Ok(Object.freeze(withProgress));
};

// ─────────────────────────────────────────────
// HELPERS INTERNOS
// ─────────────────────────────────────────────

/**
 * Calcula o progresso percentual de uma meta.
 * @param {{ currentAmount: number, targetAmount: number }} goal
 * @returns {{ percent: number, display: string, color: string }}
 */
const calculateProgress = (goal) => {
  const percent = goal.targetAmount > 0
    ? Math.min(100, toMoney((goal.currentAmount / goal.targetAmount) * 100))
    : 0;

  return Object.freeze({
    percent,
    display: `${percent.toFixed(1)}%`,
    color: percent >= 100 ? '#22C55E' : percent >= 75 ? '#84CC16' : percent >= 50 ? '#F59E0B' : '#6366F1',
  });
};

/**
 * Calcula meses até o prazo.
 * @param {string} deadline — ISO date
 * @returns {number}
 */
const getMonthsUntilDeadline = (deadline) => {
  const now    = new Date();
  const target = new Date(deadline);
  return Math.max(0, (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth()));
};

/**
 * Converte taxa Selic anual para taxa mensal.
 * Se não fornecida, usa default de 10.5% a.a. (aproximado 2025).
 * @param {number} [annualRate] — % a.a. (ex: 10.5)
 * @returns {number} taxa mensal decimal
 */
const getMonthlyRate = (annualRate) => {
  const rate = annualRate != null ? annualRate / 100 : 0.105;
  return Number((Math.pow(1 + rate, 1 / 12) - 1).toFixed(6));
};

/**
 * Gera cenários alternativos de aporte.
 * @param {number} remaining
 * @param {number} monthsLeft
 * @param {number} monthlyRate
 * @returns {Array}
 */
const generateScenarios = (remaining, monthsLeft, monthlyRate) => {
  if (remaining <= 0 || monthsLeft <= 0) return [];
  const scenarios = [0.5, 1.0, 1.5, 2.0].map((multiplier) => {
    const months  = Math.round(monthsLeft * multiplier);
    const payment = months > 0 ? Math.abs(pmt(monthlyRate, months, 0, -remaining)) : 0;
    return Object.freeze({ months, payment, label: `Em ${months} meses` });
  });
  return Object.freeze(scenarios);
};

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// FUNÇÕES PURAS TESTÁVEIS
// ─────────────────────────────────────────────

/** Calcula % de progresso (0–100). */
const calculateGoalProgress = (current, target) => {
  if (target <= 0) return 0;
  return Math.min(100, toMoney((current / target) * 100));
};

/** Retorna true se a meta foi atingida. */
const isGoalCompleted = (current, target) => current >= target;

/**
 * Simula o aporte mensal necessário para atingir a meta (puro, sem deps).
 */
const simulateGoalContribution = ({ targetAmount, currentAmount, deadline, annualRate }) => {
  const now         = new Date();
  const deadlineDate = new Date(deadline);
  if (deadlineDate <= now) return Err("O prazo já passou");
  const remaining   = targetAmount - currentAmount;
  if (remaining <= 0) return Ok({ monthlyPayment: 0, months: 0, scenarios: [] });
  const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;
  const months      = Math.max(1, Math.round((deadlineDate - now) / (1000 * 60 * 60 * 24 * 30.44)));
  const payment     = Math.abs(pmt(monthlyRate, months, 0, -remaining));
  const scenarios   = [6, 12, 18, 24, 36].map((m) => ({
    months: m,
    payment: toMoney(Math.abs(pmt(monthlyRate, m, 0, -remaining))),
  }));
  return Ok(Object.freeze({ monthlyPayment: toMoney(payment), months, scenarios }));
};

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = Object.freeze({
  createGoal,
  contributeToGoal,
  getGoalSimulation,
  listGoals,
  calculateProgress,
  getMonthsUntilDeadline,
  createGoalRecord,
  calculateGoalProgress,
  isGoalCompleted,
  simulateGoalContribution,
});
