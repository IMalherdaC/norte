/**
 * @module database/repositories/budget.repository
 */
'use strict';

const { queryOne, queryAll, execute } = require('../connection');

const toBudget = (row) => {
  if (!row) return null;
  return Object.freeze({
    id:           row.id,
    userId:       row.user_id,
    categoryId:   row.category_id,
    month:        row.month,
    limitAmount:  row.limit_amount,
    method:       row.method,
    categoryName: row.category_name,
    categoryIcon: row.category_icon,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  });
};

const findBudget = (userId, categoryId, month) =>
  toBudget(queryOne(
    'SELECT b.*, c.name AS category_name, c.icon AS category_icon FROM budgets b LEFT JOIN categories c ON c.id = b.category_id WHERE b.user_id = ? AND b.category_id = ? AND b.month = ?',
    [userId, categoryId, month]
  ));

const getBudgetsByMonth = (userId, month) =>
  queryAll(
    'SELECT b.*, c.name AS category_name, c.icon AS category_icon FROM budgets b LEFT JOIN categories c ON c.id = b.category_id WHERE b.user_id = ? AND b.month = ? ORDER BY b.created_at ASC',
    [userId, month]
  ).map(toBudget);

const saveBudget = (budget) => {
  execute(
    'INSERT INTO budgets(id, user_id, category_id, month, limit_amount, method, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    [budget.id, budget.userId, budget.categoryId, budget.month, budget.limitAmount, budget.method || 'manual', budget.createdAt, budget.updatedAt]
  );
};

const updateBudget = (id, updates) => {
  execute(
    'UPDATE budgets SET limit_amount = ?, updated_at = ? WHERE id = ?',
    [updates.limitAmount, new Date().toISOString(), id]
  );
};

module.exports = Object.freeze({ findBudget, getBudgetsByMonth, saveBudget, updateBudget });
