/**
 * @module database/repositories/user.repository
 * @description Repositório de usuários — funções puras de acesso a dados.
 * Implementa o contrato de dependências do auth.service.
 * ZERO SQL raw exposto — usa os helpers de connection.js.
 */
'use strict';

const { queryOne, queryAll, execute, withTransaction } = require('../connection');
const { v4: uuidv4 } = require('uuid');

// ─── Mappers (snake_case DB → camelCase domínio) ───
const toUser = (row) => {
  if (!row) return null;
  return Object.freeze({
    id:                   row.id,
    email:                row.email,
    passwordHash:         row.password_hash,
    name:                 row.name,
    avatarUrl:            row.avatar_url,
    role:                 row.role,
    provider:             row.provider,
    googleId:             row.google_id,
    isVerified:           Boolean(row.is_verified),
    isMEI:                Boolean(row.is_mei),
    twoFactorEnabled:     Boolean(row.two_factor_enabled),
    twoFactorSecret:      row.two_factor_secret,
    pendingTwoFactorSecret: row.pending_2fa_secret,
    loginAttempts:        row.login_attempts,
    lastFailedAt:         row.last_failed_at,
    privacyMode:          Boolean(row.privacy_mode),
    darkMode:             Boolean(row.dark_mode),
    deletionRequestedAt:  row.deletion_requested_at,
    deletedAt:            row.deleted_at,
    createdAt:            row.created_at,
    updatedAt:            row.updated_at,
  });
};

// ─── QUERIES ───

const findUserByEmail = (email) =>
  toUser(queryOne(
    'SELECT * FROM users WHERE email = ? AND deleted_at IS NULL',
    [email.toLowerCase().trim()]
  ));

const findUserById = (id) =>
  toUser(queryOne(
    'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL',
    [id]
  ));

const findUserByGoogleId = (googleId) =>
  toUser(queryOne(
    'SELECT * FROM users WHERE google_id = ? AND deleted_at IS NULL',
    [googleId]
  ));

// ─── COMMANDS ───

const saveUser = (user) => {
  execute(
    `INSERT INTO users(
       id, email, password_hash, name, avatar_url, role,
       provider, google_id, is_verified, is_mei,
       two_factor_enabled, two_factor_secret,
       login_attempts, privacy_mode, dark_mode,
       created_at, updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      user.id, user.email, user.passwordHash || null,
      user.name, user.avatarUrl || null, user.role || 'user',
      user.provider, user.googleId || null,
      user.isVerified ? 1 : 0, user.isMEI ? 1 : 0,
      user.twoFactorEnabled ? 1 : 0, user.twoFactorSecret || null,
      0, // loginAttempts
      user.privacyMode ? 1 : 0, user.darkMode ? 1 : 0,
      user.createdAt, user.updatedAt,
    ]
  );
  return findUserById(user.id);
};

const updateUser = (id, updates) => {
  const fields = [];
  const values = [];

  if (updates.passwordHash !== undefined) { fields.push('password_hash = ?');    values.push(updates.passwordHash); }
  if (updates.name         !== undefined) { fields.push('name = ?');             values.push(updates.name); }
  if (updates.avatarUrl    !== undefined) { fields.push('avatar_url = ?');       values.push(updates.avatarUrl); }
  if (updates.googleId     !== undefined) { fields.push('google_id = ?');        values.push(updates.googleId); }
  if (updates.isVerified   !== undefined) { fields.push('is_verified = ?');      values.push(updates.isVerified ? 1 : 0); }
  if (updates.twoFactorEnabled !== undefined) { fields.push('two_factor_enabled = ?'); values.push(updates.twoFactorEnabled ? 1 : 0); }
  if (updates.twoFactorSecret  !== undefined) { fields.push('two_factor_secret = ?');  values.push(updates.twoFactorSecret); }
  if (updates.pendingTwoFactorSecret !== undefined) { fields.push('pending_2fa_secret = ?'); values.push(updates.pendingTwoFactorSecret); }
  if (updates.privacyMode  !== undefined) { fields.push('privacy_mode = ?');     values.push(updates.privacyMode ? 1 : 0); }
  if (updates.darkMode     !== undefined) { fields.push('dark_mode = ?');        values.push(updates.darkMode ? 1 : 0); }
  if (updates.deletionRequestedAt !== undefined) { fields.push('deletion_requested_at = ?'); values.push(updates.deletionRequestedAt); }

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
  return findUserById(id);
};

const incrementLoginAttempt = (id) => {
  execute(
    'UPDATE users SET login_attempts = login_attempts + 1, last_failed_at = ? WHERE id = ?',
    [new Date().toISOString(), id]
  );
};

const resetLoginAttempt = (id) => {
  execute(
    'UPDATE users SET login_attempts = 0, last_failed_at = NULL WHERE id = ?',
    [id]
  );
};

// ─── SESSIONS ───

const saveSession = (session) => {
  execute(
    `INSERT INTO sessions(id, user_id, refresh_token_hash, user_agent, ip, is_active, created_at, expires_at)
     VALUES (?,?,?,?,?,1,?,?)`,
    [session.id, session.userId, session.refreshTokenHash,
     session.userAgent || null, session.ip || null,
     session.createdAt, session.expiresAt]
  );
};

const findSession = (sessionId) => {
  const row = queryOne('SELECT * FROM sessions WHERE id = ? AND is_active = 1', [sessionId]);
  if (!row) return null;
  return Object.freeze({
    id:               row.id,
    userId:           row.user_id,
    refreshTokenHash: row.refresh_token_hash,
    isActive:         Boolean(row.is_active),
    createdAt:        row.created_at,
    expiresAt:        row.expires_at,
  });
};

const updateSession = (sessionId, updates) => {
  const fields = [];
  const values = [];
  if (updates.isActive          !== undefined) { fields.push('is_active = ?');          values.push(updates.isActive ? 1 : 0); }
  if (updates.refreshTokenHash  !== undefined) { fields.push('refresh_token_hash = ?'); values.push(updates.refreshTokenHash); }
  values.push(sessionId);
  execute(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`, values);
};

const deactivateAllSessions = (userId) => {
  execute('UPDATE sessions SET is_active = 0 WHERE user_id = ?', [userId]);
};

// ─── RESET TOKENS ───

const saveResetToken = (userId, hashedToken, expiresAt) => {
  execute(
    'INSERT INTO password_reset_tokens(id, user_id, hashed_token, expires_at) VALUES (?,?,?,?)',
    [uuidv4(), userId, hashedToken, expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt]
  );
};

const findResetToken = (rawToken) => {
  // Recalcula o hash para comparar
  const { createHash } = require('crypto');
  const hash = createHash('sha256').update(rawToken).digest('hex');
  const row  = queryOne(
    'SELECT * FROM password_reset_tokens WHERE hashed_token = ? AND used_at IS NULL',
    [hash]
  );
  if (!row) return null;
  return Object.freeze({
    id:          row.id,
    userId:      row.user_id,
    hashedToken: row.hashed_token,
    expiresAt:   row.expires_at,
  });
};

const deleteResetToken = (tokenId) => {
  execute(
    'UPDATE password_reset_tokens SET used_at = ? WHERE id = ?',
    [new Date().toISOString(), tokenId]
  );
};

// ─── LGPD ───

const getAllUserData = async (userId) => {
  const user         = findUserById(userId);
  const transactions = queryAll('SELECT * FROM transactions WHERE user_id = ?', [userId]);
  const wallets      = queryAll('SELECT * FROM wallets WHERE user_id = ?', [userId]);
  const budgets      = queryAll('SELECT * FROM budgets WHERE user_id = ?', [userId]);
  const goals        = queryAll('SELECT * FROM goals WHERE user_id = ?', [userId]);
  const investments  = queryAll('SELECT * FROM investments WHERE user_id = ?', [userId]);
  const auditLog     = queryAll('SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 500', [userId]);

  // Remove campos sensíveis do export
  const { passwordHash, twoFactorSecret, ...safeUser } = user || {};

  return Object.freeze({ user: safeUser, transactions, wallets, budgets, goals, investments, auditLog });
};

module.exports = Object.freeze({
  findUserByEmail,
  findUserById,
  findUserByGoogleId,
  saveUser,
  updateUser,
  incrementLoginAttempt,
  resetLoginAttempt,
  saveSession,
  findSession,
  updateSession,
  deactivateAllSessions,
  saveResetToken,
  findResetToken,
  deleteResetToken,
  getAllUserData,
});
