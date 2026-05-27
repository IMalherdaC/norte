/**
 * @test budget.service — funções puras sem banco de dados
 */
'use strict';

const {
  calculateBudgetStatus,
  getMonthProjectionPure,
  calculateHealthScore,
  apply503020,
} = require('../finances/budgets/budget.service');

const makeBudget = (override = {}) => ({
  id: 'b-1', userId: 'u-1', categoryId: 'c-1',
  month: '2026-05', limitAmount: 1000, method: 'manual',
  categoryName: 'Alimentação', categoryIcon: '🍽️',
  ...override,
});

describe('calculateBudgetStatus', () => {
  test('verde quando gasto < 80%', () => {
    const r = calculateBudgetStatus(makeBudget(), 700);
    expect(r.status).toBe('ok');
    expect(r.percentage).toBe(70);
    expect(r.remaining).toBe(300);
  });
  test('amarelo ao atingir 80%', () => {
    expect(calculateBudgetStatus(makeBudget(), 850).status).toBe('warning');
  });
  test('vermelho ao estourar 100%', () => {
    const r = calculateBudgetStatus(makeBudget(), 1100);
    expect(r.status).toBe('danger');
    expect(r.remaining).toBeLessThan(0);
  });
  test('zero quando sem gastos', () => {
    expect(calculateBudgetStatus(makeBudget(), 0).percentage).toBe(0);
  });
});

describe('getMonthProjectionPure', () => {
  const dailyData = Array.from({ length: 15 }, (_, i) => ({
    day: i + 1, date: `2026-05-${String(i + 1).padStart(2, '0')}`, amount: 33.33,
  }));

  test('projeta gasto ao fim do mês', () => {
    const proj = getMonthProjectionPure(dailyData, '2026-05', 1000);
    expect(proj.projectedTotal).toBeGreaterThan(500);
    expect(proj.projectedTotal).toBeLessThan(2200);
    expect(proj.willExceed).toBeDefined();
  });

  test('projeta zero quando sem gastos', () => {
    const proj = getMonthProjectionPure([], '2026-05', 800);
    expect(proj.projectedTotal).toBe(0);
    expect(proj.willExceed).toBe(false);
  });
});

describe('apply503020', () => {
  test('divide renda em 50/30/20', () => {
    const r = apply503020(8500);
    expect(r.needs.amount).toBe(4250);
    expect(r.wants.amount).toBe(2550);
    expect(r.savings.amount).toBe(1700);
    expect(r.needs.amount + r.wants.amount + r.savings.amount).toBe(8500);
  });
  test('funciona com salário mínimo R$1.412', () => {
    const r = apply503020(1412);
    expect(r.needs.percentage).toBe(0.5);
    expect(r.needs.amount).toBe(706);
  });
});

describe('calculateHealthScore', () => {
  test('score alto para situação saudável', () => {
    const r = calculateHealthScore({
      liquidBalance: 30000, monthlyIncome: 8000, monthlyExpenses: 5000,
      totalDebt: 0, monthlyDebtPayments: 0,
      investmentClasses: ['fixed_income', 'variable'],
    });
    expect(r.score).toBeGreaterThan(70);
    expect(r.grade).toBeDefined();
  });

  test('score baixo para situação crítica', () => {
    const r = calculateHealthScore({
      liquidBalance: 100, monthlyIncome: 5000, monthlyExpenses: 5500,
      totalDebt: 50000, monthlyDebtPayments: 2500, investmentClasses: [],
    });
    expect(r.score).toBeLessThan(40);
  });
});
