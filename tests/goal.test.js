/**
 * @test goal.service — funções puras
 */
'use strict';

const {
  createGoalRecord,
  simulateGoalContribution,
  calculateGoalProgress,
  isGoalCompleted,
} = require('../finances/goals/goal.service');

describe('createGoalRecord', () => {
  test('cria meta com id e progresso inicial 0', () => {
    const g = createGoalRecord({
      userId: 'u1', name: 'Reserva', targetAmount: 10000,
      deadline: '2027-12-31',
    });
    expect(g.id).toBeDefined();
    expect(g.currentAmount).toBe(0);
    expect(g.isCompleted).toBe(false);
  });
});

describe('calculateGoalProgress', () => {
  test('calcula % corretamente', () => {
    expect(calculateGoalProgress(4200, 12000)).toBeCloseTo(35, 1);
    expect(calculateGoalProgress(12000, 12000)).toBe(100);
    expect(calculateGoalProgress(0, 5000)).toBe(0);
  });

  test('não ultrapassa 100%', () => {
    expect(calculateGoalProgress(15000, 10000)).toBe(100);
  });
});

describe('isGoalCompleted', () => {
  test('detecta meta concluída', () => {
    expect(isGoalCompleted(10000, 10000)).toBe(true);
    expect(isGoalCompleted(10001, 10000)).toBe(true);
    expect(isGoalCompleted(9999,  10000)).toBe(false);
  });
});

describe('simulateGoalContribution', () => {
  test('simula aporte mensal para atingir meta em prazo', () => {
    const result = simulateGoalContribution({
      targetAmount: 12000,
      currentAmount: 0,
      deadline: '2027-05-21', // ~12 meses
      annualRate: 0.105,      // Selic 10.5%
    });
    expect(result.ok).toBe(true);
    expect(result.value.monthlyPayment).toBeGreaterThan(750);
    expect(result.value.monthlyPayment).toBeLessThan(1100);
    expect(result.value.months).toBeGreaterThan(0);
  });

  test('retorna 0 para meta já concluída', () => {
    const result = simulateGoalContribution({
      targetAmount: 1000, currentAmount: 1500, deadline: '2027-01-01', annualRate: 0.105,
    });
    expect(result.ok).toBe(true);
    expect(result.value.monthlyPayment).toBe(0);
  });

  test('retorna erro para deadline no passado', () => {
    const result = simulateGoalContribution({
      targetAmount: 5000, currentAmount: 0, deadline: '2020-01-01', annualRate: 0.105,
    });
    expect(result.ok).toBe(false);
  });
});
