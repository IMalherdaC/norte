/**
 * @test analytics.service — funções puras sem banco de dados
 */
'use strict';

const {
  detectAnomaliesPure,
  calculateMEITaxReservation,
  buildCashFlowSummary,
} = require('../reports/analytics/analytics.service');

// ─── detectAnomaliesPure ───
describe('detectAnomalies (pure)', () => {
  const history = [
    { categoryId: 'cat_transport', amount: 75  },
    { categoryId: 'cat_transport', amount: 82  },
    { categoryId: 'cat_transport', amount: 78  },
    { categoryId: 'cat_transport', amount: 85  },
    { categoryId: 'cat_transport', amount: 79  },
    { categoryId: 'cat_transport', amount: 250 }, // mês atual — anomalia
  ];

  test('detecta gasto anômalo com z-score >= 2', () => {
    const anomalies = detectAnomaliesPure(history, 'cat_transport', 6);
    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies[0].zScore).toBeGreaterThan(2);
    expect(anomalies[0].isAnomaly).toBe(true);
  });

  test('não detecta anomalia em dados uniformes', () => {
    const uniform = Array.from({ length: 6 }, () => ({ categoryId: 'c1', amount: 100 }));
    const anomalies = detectAnomaliesPure(uniform, 'c1', 6);
    expect(anomalies.filter(a => a.isAnomaly)).toHaveLength(0);
  });
});

// ─── calculateMEITaxReservation ───
describe('calculateMEITaxReservation', () => {
  test('calcula reserva fiscal para MEI com receita de R$5.000', () => {
    const result = calculateMEITaxReservation(5000);
    expect(result.das).toBe(75.90);
    expect(result.provisioning).toBeGreaterThan(0);
  });

  test('DAS é fixo independente da receita', () => {
    const r1 = calculateMEITaxReservation(1000);
    const r2 = calculateMEITaxReservation(20000);
    expect(r1.das).toBe(r2.das); // DAS MEI é valor fixo
  });
});

// ─── buildCashFlowSummary ───
describe('buildCashFlowSummary', () => {
  const transactions = [
    { type: 'income',  amount: 5000, date: '2026-05-05', entityType: 'pf', categoryId: 'c1' },
    { type: 'expense', amount: 800,  date: '2026-05-10', entityType: 'pf', categoryId: 'c2' },
    { type: 'expense', amount: 1200, date: '2026-05-15', entityType: 'pf', categoryId: 'c3' },
    { type: 'income',  amount: 3000, date: '2026-05-20', entityType: 'pj', categoryId: 'c4' },
    { type: 'expense', amount: 500,  date: '2026-05-22', entityType: 'pj', categoryId: 'c5' },
  ];

  test('calcula totais globais corretamente', () => {
    const summary = buildCashFlowSummary(transactions);
    expect(summary.totalIncome).toBe(8000);
    expect(summary.totalExpenses).toBe(2500);
    expect(summary.netBalance).toBe(5500);
  });

  test('segrega PF vs PJ (cubo MEI)', () => {
    const summary = buildCashFlowSummary(transactions);
    expect(summary.pf.totalIncome).toBe(5000);
    expect(summary.pj.totalIncome).toBe(3000);
    expect(summary.pf.totalExpenses).toBe(2000);
    expect(summary.pj.totalExpenses).toBe(500);
  });

  test('filtra por entityType = pf', () => {
    const summary = buildCashFlowSummary(transactions, 'pf');
    expect(summary.totalIncome).toBe(5000);
    expect(summary.totalExpenses).toBe(2000);
  });
});
