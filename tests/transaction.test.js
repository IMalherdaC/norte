/**
 * @test transaction.service — funções puras sem banco de dados
 */
'use strict';

const {
  createTransactionRecord,
  buildInstallments,
  buildRecurringTransactions,
  buildSplits,
  buildTransferPair,
  canUndo,
  filterDuplicates,
} = require('../finances/transactions/transaction.service');

const { hashTransaction } = require('../shared/fp-utils');

// ─── createTransactionRecord ───
describe('createTransactionRecord', () => {
  const base = {
    userId: 'u1', walletId: 'w1', categoryId: 'c1',
    type: 'expense', amount: 45.90, description: 'iFood',
    date: '2026-05-21', tags: ['pix'],
  };

  test('cria registro com id e datas', () => {
    const tx = createTransactionRecord(base);
    expect(tx.id).toBeDefined();
    expect(tx.createdAt).toBeDefined();
    expect(tx.amount).toBe(45.90);
    expect(tx.type).toBe('expense');
  });

  test('gera hash de deduplicação', () => {
    const tx = createTransactionRecord(base);
    const expected = hashTransaction({ date: base.date, amount: base.amount, description: base.description });
    expect(tx.deduplicationHash).toBe(expected);
  });

  test('objeto é imutável (frozen)', () => {
    const tx = createTransactionRecord(base);
    expect(Object.isFrozen(tx)).toBe(true);
  });
});

// ─── buildInstallments ───
describe('buildInstallments', () => {
  test('gera parcelas corretas para 3x', () => {
    const result = buildInstallments({
      userId: 'u1', walletId: 'w1', categoryId: 'c1',
      totalAmount: 300, installments: 3,
      description: 'TV Samsung', date: '2026-05-10',
    });
    expect(result.ok).toBe(true);
    expect(result.value).toHaveLength(3);
    expect(result.value[0].amount).toBeCloseTo(100, 2);
    expect(result.value[1].date).toBe('2026-06-10');
    expect(result.value[2].date).toBe('2026-07-10');
  });

  test('distribui centavos na primeira parcela', () => {
    const result = buildInstallments({
      userId: 'u1', walletId: 'w1', categoryId: 'c1',
      totalAmount: 100, installments: 3,
      description: 'teste', date: '2026-05-01',
    });
    const sum = result.value.reduce((s, t) => s + t.amount, 0);
    expect(Math.abs(sum - 100)).toBeLessThan(0.01);
  });

  test('rejeita mais de 72 parcelas', () => {
    const result = buildInstallments({
      userId: 'u1', walletId: 'w1', categoryId: 'c1',
      totalAmount: 100, installments: 73, description: 'x', date: '2026-05-01',
    });
    expect(result.ok).toBe(false);
  });
});

// ─── buildRecurringTransactions ───
describe('buildRecurringTransactions', () => {
  test('gera 12 meses de aluguel', () => {
    const result = buildRecurringTransactions({
      userId: 'u1', walletId: 'w1', categoryId: 'c1',
      amount: 1500, description: 'Aluguel', date: '2026-05-05',
      frequency: 'monthly', occurrences: 12,
    });
    expect(result.ok).toBe(true);
    expect(result.value).toHaveLength(12);
    expect(result.value[11].date).toBe('2027-04-05');
  });

  test('gera 4 semanas de academinha', () => {
    const result = buildRecurringTransactions({
      userId: 'u1', walletId: 'w1', categoryId: 'c1',
      amount: 150, description: 'Academia', date: '2026-05-01',
      frequency: 'weekly', occurrences: 4,
    });
    expect(result.ok).toBe(true);
    expect(result.value).toHaveLength(4);
    expect(result.value[1].date).toBe('2026-05-08');
  });
});

// ─── buildTransferPair ───
describe('buildTransferPair', () => {
  test('cria par de débito e crédito', () => {
    const result = buildTransferPair({
      userId: 'u1', fromWalletId: 'w1', toWalletId: 'w2',
      categoryId: 'cat_transfer', amount: 500,
      description: 'Transferência interna', date: '2026-05-21',
    });
    expect(result.ok).toBe(true);
    expect(result.value.outTx.type).toBe('transfer_out');
    expect(result.value.inTx.type).toBe('transfer_in');
    expect(result.value.outTx.amount).toBe(500);
    expect(result.value.inTx.amount).toBe(500);
  });
});

// ─── buildSplits ───
describe('buildSplits', () => {
  test('divide lançamento de R$100 em 3 partes', () => {
    const originalTx = createTransactionRecord({
      userId: 'u1', walletId: 'w1', categoryId: 'c1',
      type: 'expense', amount: 100, description: 'Mercado',
      date: '2026-05-20', tags: [],
    });

    const splits = [
      { categoryId: 'cat_food', amount: 60, description: 'Alimentos' },
      { categoryId: 'cat_hygiene', amount: 30, description: 'Higiene' },
      { categoryId: 'cat_cleaning', amount: 10, description: 'Limpeza' },
    ];

    const result = buildSplits(originalTx, splits);
    expect(result.ok).toBe(true);
    expect(result.value).toHaveLength(3);
    const total = result.value.reduce((s, t) => s + t.amount, 0);
    expect(Math.abs(total - 100)).toBeLessThan(0.01);
  });

  test('rejeita split onde soma difere do original', () => {
    const originalTx = createTransactionRecord({
      userId: 'u1', walletId: 'w1', categoryId: 'c1',
      type: 'expense', amount: 100, description: 'Mercado',
      date: '2026-05-20', tags: [],
    });
    const result = buildSplits(originalTx, [
      { categoryId: 'c1', amount: 60 },
      { categoryId: 'c2', amount: 50 }, // soma 110 ≠ 100
    ]);
    expect(result.ok).toBe(false);
  });
});

// ─── canUndo ───
describe('canUndo', () => {
  test('permite desfazer dentro de 5 segundos', () => {
    const deletedAt = new Date(Date.now() - 3000).toISOString(); // 3s atrás
    expect(canUndo(deletedAt)).toBe(true);
  });

  test('bloqueia desfazer após 5 segundos', () => {
    const deletedAt = new Date(Date.now() - 10000).toISOString(); // 10s atrás
    expect(canUndo(deletedAt)).toBe(false);
  });
});

// ─── filterDuplicates ───
describe('filterDuplicates', () => {
  test('filtra transações duplicadas por hash', () => {
    const existing = ['abc123', 'def456'];
    const incoming = [
      { deduplicationHash: 'abc123', description: 'Dup' },
      { deduplicationHash: 'new789', description: 'Nova' },
    ];
    const result = filterDuplicates(incoming, existing);
    expect(result.new).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
  });
});
