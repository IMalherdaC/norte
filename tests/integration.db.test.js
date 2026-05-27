/**
 * @test integração — banco de dados real (SQLite)
 */
'use strict';

process.env.NODE_ENV   = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-longo-para-validar-256bits-ok';
process.env.ENCRYPTION_KEY = '0000000000000000000000000000000000000000000000000000000000000000';

const { v4: uuidv4 } = require('uuid');
const { runMigrations }         = require('../database/migrations/run');
const { seedDefaultCategories } = require('../database/seeds/default_categories');
const { closeDB }               = require('../database/connection');

const userRepo   = require('../database/repositories/user.repository');
const walletRepo = require('../database/repositories/wallet.repository');
const txRepo     = require('../database/repositories/transaction.repository');
const budgetRepo = require('../database/repositories/budget.repository');
const goalRepo   = require('../database/repositories/goal.repository');

const { createTransactionRecord, buildInstallments, buildTransferPair } =
  require('../finances/transactions/transaction.service');

// IDs únicos por rodada para evitar conflito UNIQUE
const RUN   = uuidv4().slice(0, 8);
const UID   = `user-${RUN}`;
const WID   = `wallet-${RUN}`;

beforeAll(() => {
  runMigrations();
  seedDefaultCategories();
});

afterAll(() => closeDB());

// ─── Users ───
describe('User Repository', () => {
  test('salva e recupera usuário por email', () => {
    userRepo.saveUser({
      id: UID, email: `test-${RUN}@norte.app`, passwordHash: 'hash',
      name: 'Tester', provider: 'email', isVerified: true, isMEI: false,
      twoFactorEnabled: false, twoFactorSecret: null, privacyMode: false, darkMode: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const found = userRepo.findUserByEmail(`test-${RUN}@norte.app`);
    expect(found.id).toBe(UID);
    expect(found.name).toBe('Tester');
  });

  test('updateUser atualiza campos', () => {
    userRepo.updateUser(UID, { privacyMode: true });
    expect(userRepo.findUserById(UID).privacyMode).toBe(true);
  });

  test('incrementLoginAttempt e reset', () => {
    userRepo.incrementLoginAttempt(UID);
    userRepo.resetLoginAttempt(UID);
  });
});

// ─── Wallets ───
describe('Wallet Repository', () => {
  test('salva e recupera carteira', () => {
    const w = walletRepo.saveWallet({
      id: WID, userId: UID, name: 'Inter', type: 'checking',
      balance: 12000, initialBalance: 12000, color: '#F97316', icon: '🟠',
      entityType: 'pf', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    expect(w.balance).toBe(12000);
  });

  test('lista carteiras do usuário', () => {
    expect(walletRepo.listWallets(UID).length).toBeGreaterThanOrEqual(1);
  });

  test('arquiva e restaura carteira', () => {
    walletRepo.updateWallet(WID, { isArchived: true, archivedAt: new Date().toISOString() });
    expect(walletRepo.findWalletById(WID).isArchived).toBe(true);
    walletRepo.updateWallet(WID, { isArchived: false, archivedAt: null });
  });
});

// ─── Transactions ACID ───
describe('Transaction Repository — ACID', () => {
  let txId;

  test('salva transação e atualiza saldo atomicamente', () => {
    const before = walletRepo.findWalletById(WID).balance;
    const tx     = createTransactionRecord({
      userId: UID, walletId: WID, categoryId: 'cat_food_delivery',
      type: 'expense', amount: 89.90, description: 'Rappi',
      date: '2026-05-21', tags: ['pix'],
    });
    txId = tx.id;
    txRepo.saveTransactionWithBalanceUpdate(tx, WID, -89.90);
    const after = walletRepo.findWalletById(WID).balance;
    expect(Math.abs(after - (before - 89.90))).toBeLessThan(0.01);
  });

  test('soft delete — transação some da listagem', () => {
    txRepo.softDeleteTransaction(txId, { deletedAt: new Date().toISOString(), deletionToken: uuidv4() });
    expect(txRepo.findTransaction(txId)).toBeNull();
  });

  test('restore — transação volta na listagem', () => {
    txRepo.restoreTransaction(txId);
    expect(txRepo.findTransaction(txId)).not.toBeNull();
  });

  test('deduplicação — hashes armazenados', () => {
    expect(txRepo.findHashesByUserId(UID).length).toBeGreaterThan(0);
  });

  test('query paginada com filtros', () => {
    const r = txRepo.queryTransactions({ userId: UID, type: 'expense', limit: 10, skip: 0 });
    expect(r.total).toBeGreaterThanOrEqual(1);
  });
});

// ─── Parcelamentos ACID ───
describe('Installments — ACID via saveBatch', () => {
  test('salva 6 parcelas usando categoria válida (cat_food)', () => {
    const result = buildInstallments({
      userId: UID, walletId: WID,
      categoryId: 'cat_food',   // categoria default que existe no seed
      totalAmount: 600, installments: 6,
      description: 'Compra parcelada', date: '2026-05-15',
    });
    expect(result.ok).toBe(true);
    txRepo.saveBatchTransactions(result.value, WID, 'expense', 600);
    const { total } = txRepo.queryTransactions({ userId: UID, limit: 100, skip: 0 });
    expect(total).toBeGreaterThanOrEqual(6);
  });
});

// ─── Budgets ───
describe('Budget Repository', () => {
  const BID = `budget-${RUN}`;

  test('salva e recupera orçamento mensal', () => {
    budgetRepo.saveBudget({
      id: BID, userId: UID, categoryId: 'cat_food',
      month: '2026-05', limitAmount: 800, method: 'manual',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    expect(budgetRepo.getBudgetsByMonth(UID, '2026-05').length).toBeGreaterThanOrEqual(1);
  });

  test('atualiza limite de orçamento', () => {
    budgetRepo.updateBudget(BID, { limitAmount: 1000 });
    const b = budgetRepo.findBudget(UID, 'cat_food', '2026-05');
    expect(b.limitAmount).toBe(1000);
  });
});

// ─── Goals ───
describe('Goal Repository', () => {
  const GID = `goal-${RUN}`;

  test('salva e lista metas', () => {
    goalRepo.saveGoal({
      id: GID, userId: UID, name: 'Reserva de Emergência',
      description: '6 meses de custo fixo', targetAmount: 24000, currentAmount: 5000,
      deadline: '2027-12-31', icon: '🛡️', color: '#10B981',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const goals = goalRepo.listGoals(UID);
    const g     = goals.find(x => x.id === GID);
    expect(g.targetAmount).toBe(24000);
    expect(g.isCompleted).toBe(false);
  });

  test('atualiza progresso de meta', () => {
    goalRepo.updateGoal(GID, {
      currentAmount: 7000, isCompleted: false,
      completedAt: null, lastMonthlyContribution: 2000,
    });
    expect(goalRepo.findGoal(GID).currentAmount).toBe(7000);
  });
});
