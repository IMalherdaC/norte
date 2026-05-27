/**
 * @module shared/validators
 * @description Validadores puros de entrada. Retornam Result (Ok | Err).
 * Camada de validação estrita conforme requisito de segurança.
 * ZERO efeitos colaterais — apenas transformações de dados.
 */

'use strict';

const { Ok, Err, pipe } = require('../fp-utils');

// ─────────────────────────────────────────────
// PRIMITIVAS DE VALIDAÇÃO
// ─────────────────────────────────────────────

/** Verifica se valor está presente */
const required = (fieldName) => (value) =>
  value != null && value !== ''
    ? Ok(value)
    : Err(`${fieldName} é obrigatório`);

/** Verifica comprimento mínimo */
const minLength = (min, fieldName) => (value) =>
  typeof value === 'string' && value.length >= min
    ? Ok(value)
    : Err(`${fieldName} deve ter pelo menos ${min} caracteres`);

/** Verifica comprimento máximo */
const maxLength = (max, fieldName) => (value) =>
  typeof value === 'string' && value.length <= max
    ? Ok(value)
    : Err(`${fieldName} deve ter no máximo ${max} caracteres`);

/** Valida formato de e-mail */
const isEmail = (value) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
  return re.test(value) ? Ok(value) : Err('E-mail inválido');
};

/** Valida CPF (algoritmo oficial) */
const isCPF = (value) => {
  const raw = String(value).replace(/\D/g, '');
  if (raw.length !== 11 || /^(\d)\1{10}$/.test(raw)) return Err('CPF inválido');
  const calcDigit = (digits, factor) =>
    digits.reduce((acc, d, i) => acc + Number(d) * (factor - i), 0);
  const rem = (sum) => (sum % 11 < 2 ? 0 : 11 - (sum % 11));
  const d1 = rem(calcDigit(raw.split('').slice(0, 9), 10));
  const d2 = rem(calcDigit(raw.split('').slice(0, 10), 11));
  return d1 === Number(raw[9]) && d2 === Number(raw[10])
    ? Ok(raw)
    : Err('CPF inválido');
};

/** Valida CNPJ (para MEI) */
const isCNPJ = (value) => {
  const raw = String(value).replace(/\D/g, '');
  if (raw.length !== 14) return Err('CNPJ inválido');
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const calcDig = (weights) =>
    weights.reduce((acc, w, i) => acc + Number(raw[i]) * w, 0);
  const rem = (sum) => (sum % 11 < 2 ? 0 : 11 - (sum % 11));
  const d1 = rem(calcDig(weights1));
  const d2 = rem(calcDig(weights2));
  return d1 === Number(raw[12]) && d2 === Number(raw[13])
    ? Ok(raw)
    : Err('CNPJ inválido');
};

/** Valida valor monetário positivo */
const isPositiveMoney = (fieldName = 'Valor') => (value) => {
  const num = Number(value);
  return !isNaN(num) && num > 0
    ? Ok(num)
    : Err(`${fieldName} deve ser um valor positivo`);
};

/** Valida data ISO */
const isISODate = (fieldName = 'Data') => (value) => {
  const d = new Date(value);
  return !isNaN(d.getTime())
    ? Ok(new Date(value).toISOString())
    : Err(`${fieldName} inválida`);
};

// ─────────────────────────────────────────────
// VALIDADORES COMPOSTOS (para entidades do domínio)
// ─────────────────────────────────────────────

/**
 * Valida dados de cadastro/login de usuário.
 * Requisito: senha ≥ 10 caracteres.
 * @param {{ email: string, password: string }} data
 * @returns {{ ok: boolean, value?: object, error?: string }}
 */
const validateAuthCredentials = ({ email, password }) => {
  const emailResult = pipe(
    () => required('E-mail')(email),
    (r) => r.ok ? isEmail(email) : r
  )();
  if (!emailResult.ok) return emailResult;

  const pwResult = pipe(
    () => required('Senha')(password),
    (r) => r.ok ? minLength(10, 'Senha')(password) : r,
    (r) => r.ok ? maxLength(128, 'Senha')(password) : r
  )();
  if (!pwResult.ok) return pwResult;

  return Ok({ email: email.toLowerCase().trim(), password });
};

/**
 * Valida dados de uma transação financeira.
 * @param {object} tx
 */
const validateTransaction = (tx) => {
  const checks = [
    () => required('Valor')(tx.amount),
    () => isPositiveMoney('Valor')(tx.amount),
    () => required('Tipo')(tx.type),
    () => ['income', 'expense', 'transfer'].includes(tx.type)
      ? Ok(tx.type)
      : Err('Tipo inválido — use: income, expense ou transfer'),
    () => required('Data')(tx.date),
    () => isISODate('Data')(tx.date),
    () => required('Conta')(tx.walletId),
    () => required('Categoria')(tx.categoryId),
  ];

  for (const check of checks) {
    const result = check();
    if (!result.ok) return result;
  }

  // Sanitiza descrição contra XSS
  const sanitized = {
    ...tx,
    description: sanitizeText(tx.description || ''),
    amount: Number(tx.amount),
  };

  return Ok(Object.freeze(sanitized));
};

/**
 * Valida dados de uma conta/carteira.
 * @param {object} wallet
 */
const validateWallet = (wallet) => {
  const nameResult = pipe(
    () => required('Nome')(wallet.name),
    (r) => r.ok ? minLength(2, 'Nome')(wallet.name) : r,
    (r) => r.ok ? maxLength(50, 'Nome')(wallet.name) : r
  )();
  if (!nameResult.ok) return nameResult;

  if (!['checking', 'savings', 'cash', 'credit', 'investment'].includes(wallet.type)) {
    return Err('Tipo de conta inválido');
  }

  return Ok(Object.freeze({
    ...wallet,
    name: sanitizeText(wallet.name),
    initialBalance: wallet.initialBalance != null ? Number(wallet.initialBalance) : 0,
  }));
};

/**
 * Valida dados de orçamento mensal.
 * @param {object} budget
 */
const validateBudget = (budget) => {
  const catResult = required('Categoria')(budget.categoryId);
  if (!catResult.ok) return catResult;

  const amtResult = isPositiveMoney('Limite')(budget.limitAmount);
  if (!amtResult.ok) return amtResult;

  const monthResult = /^\d{4}-(0[1-9]|1[0-2])$/.test(budget.month)
    ? Ok(budget.month)
    : Err('Mês inválido — use formato YYYY-MM');
  if (!monthResult.ok) return monthResult;

  return Ok(Object.freeze({ ...budget, limitAmount: Number(budget.limitAmount) }));
};

/**
 * Valida dados de uma meta financeira.
 * @param {object} goal
 */
const validateGoal = (goal) => {
  const nameResult = required('Nome da meta')(goal.name);
  if (!nameResult.ok) return nameResult;

  const targetResult = isPositiveMoney('Valor alvo')(goal.targetAmount);
  if (!targetResult.ok) return targetResult;

  const deadlineResult = isISODate('Prazo')(goal.deadline);
  if (!deadlineResult.ok) return deadlineResult;

  return Ok(Object.freeze({
    ...goal,
    name: sanitizeText(goal.name),
    targetAmount: Number(goal.targetAmount),
  }));
};

// ─────────────────────────────────────────────
// SANITIZAÇÃO (prevenção XSS)
// ─────────────────────────────────────────────

/**
 * Sanitiza texto removendo tags HTML e caracteres perigosos.
 * Prevenção contra XSS na camada de validação.
 * @param {string} text
 * @returns {string}
 */
const sanitizeText = (text) =>
  String(text)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .trim();

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = Object.freeze({
  required,
  minLength,
  maxLength,
  isEmail,
  isCPF,
  isCNPJ,
  isPositiveMoney,
  isISODate,
  validateAuthCredentials,
  validateTransaction,
  validateWallet,
  validateBudget,
  validateGoal,
  sanitizeText,
});
