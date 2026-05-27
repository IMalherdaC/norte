/**
 * @module database/repositories/goal.repository
 */
'use strict';

const { queryOne, queryAll, execute } = require('../connection');
const { toMoney } = require('../../shared/fp-utils');

const toGoal = (row) => {
  if (!row) return null;
  return Object.freeze({
    id:            row.id,
    userId:        row.user_id,
    name:          row.name,
    description:   row.description,
    targetAmount:  row.target_amount,
    currentAmount: row.current_amount,
    deadline:      row.deadline,
    walletId:      row.wallet_id,
    icon:          row.icon,
    color:         row.color,
    isCompleted:   Boolean(row.is_completed),
    completedAt:   row.completed_at,
    lastMonthlyContribution: row.last_monthly_contribution,
    createdAt:     row.created_at,
    updatedAt:     row.updated_at,
  });
};

const findGoal    = (id) => toGoal(queryOne('SELECT * FROM goals WHERE id = ?', [id]));
const listGoals   = (userId) => queryAll('SELECT * FROM goals WHERE user_id = ? ORDER BY created_at DESC', [userId]).map(toGoal);

const saveGoal    = (goal) => {
  execute(
    `INSERT INTO goals(id, user_id, name, description, target_amount, current_amount, deadline,
       wallet_id, icon, color, is_completed, completed_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,0,NULL,?,?)`,
    [goal.id, goal.userId, goal.name, goal.description || '',
     goal.targetAmount, goal.currentAmount || 0, goal.deadline,
     goal.walletId || null, goal.icon || '🎯', goal.color || '#6366F1',
     goal.createdAt, goal.updatedAt]
  );
};

const updateGoal  = (id, updates) => {
  execute(
    `UPDATE goals SET current_amount = ?, is_completed = ?, completed_at = ?,
     last_monthly_contribution = ?, updated_at = ? WHERE id = ?`,
    [
      toMoney(updates.currentAmount),
      updates.isCompleted ? 1 : 0,
      updates.completedAt || null,
      updates.lastMonthlyContribution || null,
      new Date().toISOString(), id,
    ]
  );
};

module.exports = Object.freeze({ findGoal, listGoals, saveGoal, updateGoal });
